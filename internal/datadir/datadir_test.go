package datadir

import (
	"os"
	"path/filepath"
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
