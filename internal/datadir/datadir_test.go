package datadir

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveExplicitFlagCreatesLayout(t *testing.T) {
	root := filepath.Join(t.TempDir(), "library")
	info, err := Resolve(root)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if info.Root != root || info.Source != "flag" {
		t.Fatalf("unexpected info: %+v", info)
	}
	for _, path := range []string{info.Root, info.WorkspacesDir, info.PluginsDir, info.BackupsDir} {
		if st, err := os.Stat(path); err != nil || !st.IsDir() {
			t.Fatalf("expected directory %s: %v", path, err)
		}
	}
	if info.WorkspaceDB("ws_test") != filepath.Join(root, "workspaces", "ws_test", "workspace.db") {
		t.Fatalf("unexpected workspace DB path: %s", info.WorkspaceDB("ws_test"))
	}
	if info.AssetsDir("ws_test") != filepath.Join(root, "workspaces", "ws_test", "assets") {
		t.Fatalf("unexpected assets path: %s", info.AssetsDir("ws_test"))
	}
}

func TestResolveEnvironment(t *testing.T) {
	root := filepath.Join(t.TempDir(), "env-library")
	t.Setenv("NOTERAL_DATA_DIR", root)
	info, err := Resolve("")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if info.Root != root || info.Source != "environment" {
		t.Fatalf("unexpected info: %+v", info)
	}
}

func TestResolveRejectsFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(file); err == nil {
		t.Fatal("expected an error when the data path is a file")
	}
}

func TestUserDataRoot(t *testing.T) {
	cases := []struct {
		name         string
		goos         string
		home         string
		xdgDataHome  string
		localAppData string
		want         string
	}{
		{"macOS", "darwin", "/Users/ada", "", "", filepath.Join("/Users/ada", "Library", "Application Support", "Noteral")},
		{"Windows local app data", "windows", `C:\Users\ada`, "", `C:\Users\ada\AppData\Local`, filepath.Join(`C:\Users\ada\AppData\Local`, "Noteral")},
		{"Windows home fallback", "windows", `C:\Users\ada`, "", "", filepath.Join(`C:\Users\ada`, "AppData", "Local", "Noteral")},
		{"Linux XDG data home", "linux", "/home/ada", "/mnt/library", "", filepath.Join("/mnt/library", "noteral")},
		{"Linux relative XDG ignored", "linux", "/home/ada", "relative/path", "", filepath.Join("/home/ada", ".local", "share", "noteral")},
		{"Linux default", "linux", "/home/ada", "", "", filepath.Join("/home/ada", ".local", "share", "noteral")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := userDataRoot(tc.goos, tc.home, tc.xdgDataHome, tc.localAppData)
			if err != nil {
				t.Fatalf("userDataRoot: %v", err)
			}
			if got != tc.want {
				t.Fatalf("userDataRoot = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUserDataRootNeedsHome(t *testing.T) {
	for _, goos := range []string{"darwin", "windows", "linux"} {
		if _, err := userDataRoot(goos, "", "", ""); err == nil {
			t.Fatalf("%s: expected an error without a home directory", goos)
		}
	}
}

func TestDefaultRootUsesPerUserDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_DATA_HOME", "")
	t.Setenv("LOCALAPPDATA", "")
	want, err := userDataRoot(runtime.GOOS, home, "", "")
	if err != nil {
		t.Fatalf("userDataRoot: %v", err)
	}
	got, err := DefaultRoot()
	if err != nil {
		t.Fatalf("DefaultRoot: %v", err)
	}
	if got != want {
		t.Fatalf("DefaultRoot = %q, want %q", got, want)
	}
}

func TestMigrateLegacyData(t *testing.T) {
	legacy := filepath.Join(t.TempDir(), "Data")
	if err := os.MkdirAll(filepath.Join(legacy, "workspaces", "ws_one"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "noteral.db"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "workspaces", "ws_one", "workspace.db"), []byte("ws"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "home", ".local", "share", "noteral")
	moved, err := migrateLegacyData(target, legacy)
	if err != nil {
		t.Fatalf("migrateLegacyData: %v", err)
	}
	if !moved {
		t.Fatal("expected the legacy library to be moved")
	}
	if _, err := os.Stat(legacy); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("legacy folder still exists: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(target, "workspaces", "ws_one", "workspace.db"))
	if err != nil || string(got) != "ws" {
		t.Fatalf("moved workspace DB = %q, %v", got, err)
	}
}

func TestMigrateLegacyDataSkipsExistingLibrary(t *testing.T) {
	legacy := filepath.Join(t.TempDir(), "Data")
	target := filepath.Join(t.TempDir(), "noteral")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "noteral.db"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "noteral.db"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	moved, err := migrateLegacyData(target, legacy)
	if err != nil {
		t.Fatalf("migrateLegacyData: %v", err)
	}
	if moved {
		t.Fatal("did not expect an existing library to be replaced")
	}
	got, err := os.ReadFile(filepath.Join(target, "noteral.db"))
	if err != nil || string(got) != "new" {
		t.Fatalf("target DB = %q, %v", got, err)
	}
}

func TestMigrateLegacyDataWithoutLegacyLibrary(t *testing.T) {
	moved, err := migrateLegacyData(filepath.Join(t.TempDir(), "noteral"), filepath.Join(t.TempDir(), "Data"))
	if err != nil {
		t.Fatalf("migrateLegacyData: %v", err)
	}
	if moved {
		t.Fatal("did not expect a migration without a legacy library")
	}
}
