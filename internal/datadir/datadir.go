// Package datadir resolves and prepares Noteral's single portable data root.
package datadir

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Info describes the concrete locations under one portable data root.
type Info struct {
	Root          string
	AppDB         string
	WorkspacesDir string
	PluginsDir    string
	BackupsDir    string
	Source        string
}

// Resolve determines the data root. Precedence: explicit flag, NOTERAL_DATA_DIR,
// then a Data directory beside the executable (beside the .app on macOS).
// The directory is created when needed and probed for writability before use.
func Resolve(flagValue string) (Info, error) {
	source := "flag"
	root := strings.TrimSpace(flagValue)
	if root == "" {
		source = "environment"
		root = strings.TrimSpace(os.Getenv("NOTERAL_DATA_DIR"))
	}
	if root == "" {
		source = "executable"
	}
	if root == "" {
		var err error
		root, err = DefaultRoot()
		if err != nil {
			return Info{}, err
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

// DefaultRoot picks a directory beside the running executable.
func DefaultRoot() (string, error) {
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

// Prepare creates the root layout and verifies that the root is writable.
func Prepare(info Info) error {
	for _, dir := range []string{info.Root, info.WorkspacesDir, info.PluginsDir, info.BackupsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("Noteral cannot create its data directory at %s.\n\n%v\n\nChoose a writable folder with --data-dir <path>.", dir, err)
		}
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Errorf("prepare data directory %s: %w", info.Root, err)
	}
	probe := filepath.Join(info.Root, ".noteral-write-test-"+hex.EncodeToString(suffix[:]))
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("Noteral's data directory is not writable: %s.\n\n%v\n\nChoose a writable folder with --data-dir <path>.", info.Root, err)
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
