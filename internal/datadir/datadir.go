// Package datadir resolves and prepares Noteral's single data root: by default
// the platform's per-user application-data directory.
package datadir

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	overrideEnv = "NOTERAL_DATA_DIR"

	// macOS and Windows conventionally capitalize application folders.
	appFolderMacWindows = "Noteral"
	// Linux follows the XDG convention of lowercase data folders.
	appFolderUnix = "noteral"
)

// Info describes the concrete locations under one data root.
type Info struct {
	Root          string
	AppDB         string
	WorkspacesDir string
	PluginsDir    string
	BackupsDir    string
	Source        string
}

// Resolve determines the data root. Precedence: explicit flag, NOTERAL_DATA_DIR,
// then the platform's per-user application-data directory. A library left in an
// older build's Data/ directory beside the executable is moved to the new root
// once. The directory is created when needed and probed for writability before
// use.
func Resolve(flagValue string) (Info, error) {
	source := "flag"
	root := strings.TrimSpace(flagValue)
	if root == "" {
		source = "environment"
		root = strings.TrimSpace(os.Getenv(overrideEnv))
	}
	if root == "" {
		source = "default"
		var err error
		root, err = DefaultRoot()
		if err != nil {
			return Info{}, err
		}
		if legacy, err := legacyRoot(); err == nil {
			moved, err := migrateLegacyData(root, legacy)
			switch {
			case err != nil:
				fmt.Fprintf(os.Stderr, "noteral: could not move existing data from %s to %s: %v\n"+
					"noteral: start Noteral with --data-dir %q to keep using the old folder.\n",
					legacy, root, err, legacy)
			case moved:
				fmt.Fprintf(os.Stderr, "noteral: moved existing data from %s to %s\n", legacy, root)
			}
		}
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return Info{Root: root, Source: source}, fmt.Errorf("resolve data directory %q: %w", root, err)
	}
	info := Info{
		Root:          abs,
		AppDB:         filepath.Join(abs, "noteral.db"),
		WorkspacesDir: filepath.Join(abs, "workspaces"),
		PluginsDir:    filepath.Join(abs, "plugins"),
		BackupsDir:    filepath.Join(abs, "backups"),
		Source:        source,
	}
	if err := Prepare(info); err != nil {
		return info, err
	}
	return info, nil
}

// DefaultRoot returns the data directory conventional desktop apps use on this
// platform. If no home directory can be resolved (containers, services), it
// falls back to a Data directory beside the executable.
func DefaultRoot() (string, error) {
	home, _ := os.UserHomeDir()
	root, err := userDataRoot(runtime.GOOS, home, os.Getenv("XDG_DATA_HOME"), os.Getenv("LOCALAPPDATA"))
	if err == nil {
		return root, nil
	}
	return legacyRoot()
}

// userDataRoot maps a platform to its conventional per-user application-data
// folder:
//
//	macOS   ~/Library/Application Support/Noteral
//	Windows %LOCALAPPDATA%\Noteral
//	other   $XDG_DATA_HOME/noteral (default ~/.local/share/noteral)
func userDataRoot(goos, home, xdgDataHome, localAppData string) (string, error) {
	home = strings.TrimSpace(home)
	switch goos {
	case "darwin":
		if home == "" {
			return "", errors.New("home directory is not available")
		}
		return filepath.Join(home, "Library", "Application Support", appFolderMacWindows), nil
	case "windows":
		if dir := strings.TrimSpace(localAppData); dir != "" {
			return filepath.Join(dir, appFolderMacWindows), nil
		}
		if home == "" {
			return "", errors.New("LOCALAPPDATA and the home directory are not available")
		}
		return filepath.Join(home, "AppData", "Local", appFolderMacWindows), nil
	default:
		if dir := strings.TrimSpace(xdgDataHome); dir != "" && filepath.IsAbs(dir) {
			return filepath.Join(dir, appFolderUnix), nil
		}
		if home == "" {
			return "", errors.New("home directory is not available")
		}
		return filepath.Join(home, ".local", "share", appFolderUnix), nil
	}
}

// legacyRoot is the pre-migration default: Data beside the running executable
// (beside the .app on macOS). It remains the fallback when no home directory is
// available and is the source for the one-time data migration.
func legacyRoot() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate Noteral executable: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", fmt.Errorf("resolve Noteral executable %q: %w", exe, err)
	}
	dir := filepath.Dir(exe)
	if runtime.GOOS == "darwin" {
		// .../Noteral.app/Contents/MacOS/Noteral -> .../Data
		macOS := filepath.Dir(dir)
		contents := filepath.Dir(macOS)
		if filepath.Base(macOS) == "MacOS" && filepath.Base(contents) == "Contents" && strings.HasSuffix(filepath.Base(filepath.Dir(contents)), ".app") {
			return filepath.Join(filepath.Dir(filepath.Dir(contents)), "Data"), nil
		}
	}
	return filepath.Join(dir, "Data"), nil
}

// migrateLegacyData moves a legacy Data/ library into target when target does
// not already contain a database. It reports whether a move happened.
func migrateLegacyData(target, legacy string) (bool, error) {
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false, err
	}
	legacyAbs, err := filepath.Abs(legacy)
	if err != nil {
		return false, err
	}
	if samePath(legacyAbs, targetAbs) {
		return false, nil
	}
	switch _, err := os.Stat(filepath.Join(targetAbs, "noteral.db")); {
	case err == nil:
		return false, nil
	case !errors.Is(err, fs.ErrNotExist):
		return false, err
	}
	if _, err := os.Stat(filepath.Join(legacyAbs, "noteral.db")); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	if err := moveDir(legacyAbs, targetAbs); err != nil {
		return false, err
	}
	return true, nil
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

// moveDir renames src to dst, falling back to copy-and-delete when the two
// locations are on different filesystems.
func moveDir(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if entries, err := os.ReadDir(dst); err == nil {
		if len(entries) > 0 {
			return fmt.Errorf("destination %s is not empty", dst)
		}
		if err := os.Remove(dst); err != nil {
			return err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	if err := os.RemoveAll(src); err != nil {
		return fmt.Errorf("copied data to %s but could not remove %s: %w", dst, src, err)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			return os.MkdirAll(target, info.Mode().Perm())
		case info.Mode()&os.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		case info.Mode().IsRegular():
			return copyFile(path, target, info.Mode().Perm())
		default:
			return fmt.Errorf("cannot move %s: unsupported file type", path)
		}
	})
}

func copyFile(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

// Prepare creates the root layout and verifies that the root is writable.
func Prepare(info Info) error {
	for _, dir := range []string{info.Root, info.WorkspacesDir, info.PluginsDir, info.BackupsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("Noteral cannot create its data directory at %s.\n\n%v\n\nChoose a writable folder with --data-dir <path> or set NOTERAL_DATA_DIR.", dir, err)
		}
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Errorf("prepare data directory %s: %w", info.Root, err)
	}
	probe := filepath.Join(info.Root, ".noteral-write-test-"+hex.EncodeToString(suffix[:]))
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("Noteral's data directory is not writable: %s.\n\n%v\n\nChoose a writable folder with --data-dir <path> or set NOTERAL_DATA_DIR.", info.Root, err)
	}
	_ = os.Remove(probe)
	return nil
}

// WorkspaceDB is the database path for a workspace ID.
func (i Info) WorkspaceDB(id string) string {
	return filepath.Join(i.WorkspacesDir, id, "workspace.db")
}

// WorkspaceRoot is the directory for a workspace's database and assets.
func (i Info) WorkspaceRoot(id string) string {
	return filepath.Join(i.WorkspacesDir, id)
}

// AssetsDir is the per-workspace asset directory.
func (i Info) AssetsDir(id string) string {
	return filepath.Join(i.WorkspaceRoot(id), "assets")
}

// ErrNotWritable can be checked with errors.Is when callers need to distinguish
// filesystem setup failures from other startup failures.
var ErrNotWritable = errors.New("data directory is not writable")
