package plugins

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginStorage(t *testing.T) {
	useFixtureCatalog(t)
	manager, _ := testManager(t)
	const id = "com.noteral.reading-time"
	if err := manager.StorageSet(id, "", "a", `1`); err == nil {
		t.Fatal("storage needs an installed plugin")
	}
	if _, err := manager.InstallCatalog(id, []string{"editor.read", "ui.status", "ui.panel", "ui.modal", "settings.read", "settings.write"}); err != nil {
		t.Fatal(err)
	}

	if got, err := manager.StorageGet(id, "", "missing"); err != nil || got != "" {
		t.Fatalf("missing key: %q %v", got, err)
	}
	if err := manager.StorageSet(id, "", "index/pages", `{"n":2}`); err != nil {
		t.Fatal(err)
	}
	if err := manager.StorageSet(id, "", "cache", `[1,2]`); err != nil {
		t.Fatal(err)
	}
	if err := manager.StorageSet(id, "ws1", "index/pages", `"workspace"`); err != nil {
		t.Fatal(err)
	}
	if got, _ := manager.StorageGet(id, "", "index/pages"); got != `{"n":2}` {
		t.Fatalf("global value: %q", got)
	}
	if got, _ := manager.StorageGet(id, "ws1", "index/pages"); got != `"workspace"` {
		t.Fatalf("workspace value: %q", got)
	}
	list, err := manager.StorageList(id, "", "index/")
	if err != nil || len(list) != 1 || list[0].Key != "index/pages" || list[0].Size != 7 {
		t.Fatalf("list: %+v %v", list, err)
	}
	usage, err := manager.StorageUsage(id)
	if err != nil || usage.Keys != 3 || usage.Bytes != int64(len(`{"n":2}`)+len(`[1,2]`)+len(`"workspace"`)) {
		t.Fatalf("usage: %+v %v", usage, err)
	}

	for _, bad := range []string{"", "../x", "a/../../b", strings.Repeat("k", 201), "sp ace"} {
		if err := manager.StorageSet(id, "", bad, `1`); err == nil {
			t.Fatalf("key %q must be rejected", bad)
		}
	}
	if err := manager.StorageSet(id, "../other", "k", `1`); err == nil {
		t.Fatal("bad scope must be rejected")
	}
	if err := manager.StorageSet(id, "", "k", `{not json`); err == nil {
		t.Fatal("invalid JSON must be rejected")
	}
	if err := manager.StorageSet(id, "", "big", `"`+strings.Repeat("x", MaxStorageValueBytes)+`"`); err == nil {
		t.Fatal("oversized value must be rejected")
	}

	if err := manager.StorageSet(id, "", "cache", `null`); err != nil {
		t.Fatal(err)
	}
	if got, _ := manager.StorageGet(id, "", "cache"); got != "" {
		t.Fatalf("null should delete: %q", got)
	}
	if n, err := manager.StorageClear(id, "ws1", ""); err != nil || n != 1 {
		t.Fatalf("clear: %d %v", n, err)
	}

	// Settings: null removes a key.
	if _, err := manager.SaveSettings(id, map[string]any{"a": "x", "b": "y"}); err != nil {
		t.Fatal(err)
	}
	settings, err := manager.SaveSettings(id, map[string]any{"a": nil})
	if _, has := settings["a"]; err != nil || has || settings["b"] != "y" {
		t.Fatalf("null should remove a setting: %+v %v", settings, err)
	}

	// Storage survives a reinstall-free toggle and is removed on uninstall.
	root := filepath.Join(manager.info.Root, StorageDirName, id)
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("storage root: %v", err)
	}
	if err := manager.Uninstall(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("uninstall should remove storage: %v", err)
	}
}

func TestReadBundledFile(t *testing.T) {
	useFixtureCatalog(t)
	manager, _ := testManager(t)
	const id = "com.noteral.reading-time"
	if _, err := manager.InstallCatalog(id, []string{"editor.read", "ui.status", "ui.panel", "ui.modal", "settings.read", "settings.write"}); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(manager.info.PluginsDir, id)
	if err := os.MkdirAll(filepath.Join(base, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "data", "words.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := manager.ReadBundledFile(id, "data/words.txt", "text"); err != nil || got != "hi" {
		t.Fatalf("text: %q %v", got, err)
	}
	if got, err := manager.ReadBundledFile(id, "./data/words.txt", "base64"); err != nil || got != "aGk=" {
		t.Fatalf("base64: %q %v", got, err)
	}
	for _, bad := range []string{"../plugins.db", "/etc/passwd", "settings.json", ".settings.json.tmp", "data/missing", "data"} {
		if _, err := manager.ReadBundledFile(id, bad, "text"); err == nil && bad != "/etc/passwd" {
			t.Fatalf("%q must fail", bad)
		}
	}
	if _, err := manager.ReadBundledFile(id, "/etc/passwd", "text"); err == nil {
		t.Fatal("absolute paths resolve inside the bundle and /etc/passwd is not there")
	}
}
