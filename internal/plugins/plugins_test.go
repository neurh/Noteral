package plugins

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

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

// useFixtureCatalog swaps the bundled catalog (empty in the shipped app) for two test plugins.
func useFixtureCatalog(t *testing.T) {
	t.Helper()
	plugins := []Manifest{
		{ID: "com.noteral.reading-time", Name: "Reading Time", Version: "2.0.0", SDKVersion: "2.0.0", Entry: "main.js",
			Permissions: []string{"editor.read", "ui.status", "ui.panel", "ui.modal", "settings.read", "settings.write"}},
		{ID: "com.noteral.meeting-notes", Name: "Meeting Notes", Version: "2.0.0", SDKVersion: "2.0.0", Entry: "main.js",
			Permissions: []string{"editor.read", "editor.write", "pages.write", "ui.notify"}},
	}
	files := fstest.MapFS{}
	for _, man := range plugins {
		data, err := json.Marshal(man)
		if err != nil {
			t.Fatal(err)
		}
		files["catalog/plugins/"+man.ID+"/manifest.json"] = &fstest.MapFile{Data: data}
		files["catalog/plugins/"+man.ID+"/main.js"] = &fstest.MapFile{Data: []byte("Noteral.register(class extends Noteral.Plugin {});")}
	}
	index, err := json.Marshal(CatalogFile{Version: 1, Plugins: plugins})
	if err != nil {
		t.Fatal(err)
	}
	files["catalog/catalog.json"] = &fstest.MapFile{Data: index}
	previous := catalogFS
	catalogFS = files
	t.Cleanup(func() { catalogFS = previous })
}

func TestShippedCatalogIsEmpty(t *testing.T) {
	manager, _ := testManager(t)
	catalog, err := manager.Catalog()
	if err != nil || len(catalog) != 0 {
		t.Fatalf("the app ships no bundled plugins: %+v %v", catalog, err)
	}
}

func TestCatalogInstallToggleRuntimeAndUninstall(t *testing.T) {
	useFixtureCatalog(t)
	manager, _ := testManager(t)
	catalog, err := manager.Catalog()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(catalog) != 2 {
		t.Fatalf("expected 2 fixture plugins, got %d", len(catalog))
	}
	const id = "com.noteral.reading-time"
	if _, err := manager.InstallCatalog(id, nil); err == nil {
		t.Fatal("install without approval must fail")
	}
	if _, err := manager.InstallCatalog(id, []string{"editor.read"}); err == nil || !strings.Contains(err.Error(), "ui.status") {
		t.Fatalf("partial approval must name the missing permission, got %v", err)
	}
	info, err := manager.InstallCatalog(id, []string{"editor.read", "ui.status", "ui.panel", "ui.modal", "settings.read", "settings.write"})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !info.Enabled {
		t.Fatal("approved catalog install should be enabled")
	}
	if _, err := manager.Toggle(id, false); err != nil {
		t.Fatal(err)
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
	if _, err := manager.InstallFromZip(zipPath, []string{}); err == nil {
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
	bad.SDKVersion = "3.0.0"
	if _, err := validateManifest(bad); err == nil {
		t.Fatal("unsupported SDK accepted")
	}
	v2 := base
	v2.SDKVersion = "^2.0.0"
	if _, err := validateManifest(v2); err != nil {
		t.Fatalf("SDK 2 rejected: %v", err)
	}
	noSDK := base
	noSDK.SDKVersion, noSDK.Entry = "", ""
	got, err := validateManifest(noSDK)
	if err != nil || got.SDKVersion != SDKVersion || got.Entry != "main.js" {
		t.Fatalf("defaults not applied: %+v %v", got, err)
	}
	bad = base
	bad.MinAppVersion = "soon"
	if _, err := validateManifest(bad); err == nil {
		t.Fatal("non-semver minAppVersion accepted")
	}
}

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0}, {"1.0.1", "1.0.0", 1}, {"1.2.0", "1.10.0", -1},
		{"2.0.0", "10.0.0", -1}, {"1.0.0-beta", "1.0.0", -1}, {"v1.0.0", "1.0.0", 0},
		{"1.0.0-beta.2", "1.0.0-beta.1", 1},
	}
	for _, c := range cases {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}
