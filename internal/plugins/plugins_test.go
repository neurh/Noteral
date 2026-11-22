package plugins

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"noteral/internal/datadir"
	"noteral/internal/store"
)

func testManager(t *testing.T) (*Manager, *store.Store) {
	t.Helper()
	info, err := datadir.Resolve(filepath.Join(t.TempDir(), "Data"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(info)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, info), st
}

func TestCatalogInstallToggleRuntimeAndUninstall(t *testing.T) {
	manager, _ := testManager(t)
	catalog, err := manager.Catalog()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(catalog) != 2 {
		t.Fatalf("expected 2 bundled plugins, got %d", len(catalog))
	}
	const id = "com.noteral.reading-time"
	info, err := manager.InstallCatalog(id)
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if info.Enabled {
		t.Fatal("catalog install must start disabled")
	}
	if _, err := manager.Runtime(id); err == nil {
		t.Fatal("disabled plugin must not expose runtime code")
	}
	info, err = manager.Toggle(id, true)
	if err != nil || !info.Enabled {
		t.Fatalf("toggle on: %+v %v", info, err)
	}
	runtime, err := manager.Runtime(id)
	if err != nil {
		t.Fatalf("runtime: %v", err)
	}
	if runtime.ID != id || len(runtime.Code) == 0 || runtime.Manifest.Name != "Reading Time" {
		t.Fatalf("unexpected runtime: %+v", runtime)
	}
	settings, err := manager.GetSettings(id)
	if err != nil || len(settings) != 0 {
		t.Fatalf("initial settings: %+v %v", settings, err)
	}
	settings, err = manager.SaveSettings(id, map[string]any{"minutes": float64(3), "label": "read"})
	if err != nil || settings["label"] != "read" {
		t.Fatalf("save settings: %+v %v", settings, err)
	}
	if _, err := manager.Toggle(id, false); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	if _, err := manager.Runtime(id); err == nil {
		t.Fatal("disabled plugin still returns runtime")
	}
	if err := manager.Uninstall(id); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	list, err := manager.List()
	if err != nil || len(list) != 0 {
		t.Fatalf("after uninstall: %+v %v", list, err)
	}
}

func TestInstallZipRejectsTraversal(t *testing.T) {
	manager, _ := testManager(t)
	zipPath := filepath.Join(t.TempDir(), "evil.zip")
	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, body := range map[string]string{
		"plugin.json":    `{"id":"com.example.evil","name":"Evil","version":"1.0.0","sdkVersion":"1.0.0","entry":"plugin.js"}`,
		"../escaped.txt": "should not be written",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InstallFromZip(zipPath); err == nil {
		t.Fatal("expected traversal zip to be rejected")
	}
}

func TestValidateManifestPermissionsAndEntry(t *testing.T) {
	base := Manifest{ID: "com.example.test", Name: "Test", Version: "1.0.0", SDKVersion: "1.0.0", Entry: "plugin.js"}
	if _, err := validateManifest(base); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	bad := base
	bad.Permissions = []string{"filesystem.read"}
	if _, err := validateManifest(bad); err == nil {
		t.Fatal("unknown permission accepted")
	}
	bad = base
	bad.Entry = "../plugin.js"
	if _, err := validateManifest(bad); err == nil {
		t.Fatal("escaping entry accepted")
	}
	bad = base
	bad.SDKVersion = "2.0.0"
	if _, err := validateManifest(bad); err == nil {
		t.Fatal("unsupported SDK accepted")
	}
}
