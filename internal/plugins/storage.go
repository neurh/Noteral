package plugins

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Plugin storage is a private key/value store each plugin owns, kept outside
// the plugin folder so updates never touch it:
//
//	<data>/plugin-data/<plugin id>/global/<key>.json
//	<data>/plugin-data/<plugin id>/ws-<workspace id>/<key>.json
//
// Values are JSON documents. Settings (settings.json) stay small and are what
// the user edits; storage is for the plugin's own state, caches and indexes.
const (
	StorageDirName       = "plugin-data"
	MaxStorageValueBytes = 8 << 20  // one value
	MaxStorageBytes      = 64 << 20 // everything one plugin stores
	MaxStorageKeys       = 5000
	maxStorageKeyLen     = 200
)

var (
	storageKeyRe   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$`)
	storageScopeRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$`)
	storageLocks   sync.Map // plugin id → *sync.Mutex
)

// StorageEntry describes one stored key.
type StorageEntry struct {
	Key      string `json:"key"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

// StorageUsage reports how much a plugin stores.
type StorageUsage struct {
	Keys     int   `json:"keys"`
	Bytes    int64 `json:"bytes"`
	MaxBytes int64 `json:"maxBytes"`
}

func storageLock(id string) *sync.Mutex {
	lock, _ := storageLocks.LoadOrStore(id, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func validStorageKey(key string) error {
	if key == "" || len(key) > maxStorageKeyLen || !storageKeyRe.MatchString(key) || strings.Contains(key, "..") {
		return fmt.Errorf("storage keys are 1-%d characters of letters, digits and . _ - : / @ +", maxStorageKeyLen)
	}
	return nil
}

func (m *Manager) storageRoot(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid plugin id")
	}
	return filepath.Join(m.info.Root, StorageDirName, id), nil
}

// storageDir resolves a scope: "" is global, anything else is a workspace id.
func (m *Manager) storageDir(id, scope string) (string, error) {
	root, err := m.storageRoot(id)
	if err != nil {
		return "", err
	}
	if scope == "" {
		return filepath.Join(root, "global"), nil
	}
	if !storageScopeRe.MatchString(scope) {
		return "", fmt.Errorf("invalid storage scope")
	}
	return filepath.Join(root, "ws-"+scope), nil
}

func storageFile(dir, key string) string {
	return filepath.Join(dir, base64.RawURLEncoding.EncodeToString([]byte(key))+".json")
}

func storageKeyOf(name string) (string, bool) {
	if !strings.HasSuffix(name, ".json") {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSuffix(name, ".json"))
	if err != nil {
		return "", false
	}
	return string(raw), validStorageKey(string(raw)) == nil
}

// StorageGet returns the raw JSON stored under key, or "" when there is none.
func (m *Manager) StorageGet(id, scope, key string) (string, error) {
	if err := validStorageKey(key); err != nil {
		return "", err
	}
	if _, err := m.installedBase(id); err != nil {
		return "", err
	}
	dir, err := m.storageDir(id, scope)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(storageFile(dir, key))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	return string(data), err
}

// StorageSet stores raw JSON under key. An empty value or JSON null deletes it.
func (m *Manager) StorageSet(id, scope, key, value string) error {
	if err := validStorageKey(key); err != nil {
		return err
	}
	if trimmed := strings.TrimSpace(value); trimmed == "" || trimmed == "null" {
		return m.StorageDelete(id, scope, key)
	}
	if len(value) > MaxStorageValueBytes {
		return fmt.Errorf("a stored value can be at most %d MB", MaxStorageValueBytes>>20)
	}
	if !json.Valid([]byte(value)) {
		return fmt.Errorf("stored values must be JSON")
	}
	if _, err := m.installedBase(id); err != nil {
		return err
	}
	dir, err := m.storageDir(id, scope)
	if err != nil {
		return err
	}
	lock := storageLock(id)
	lock.Lock()
	defer lock.Unlock()

	file := storageFile(dir, key)
	usage, err := m.storageUsageLocked(id)
	if err != nil {
		return err
	}
	var previous int64
	if info, err := os.Stat(file); err == nil {
		previous = info.Size()
	} else if usage.Keys >= MaxStorageKeys {
		return fmt.Errorf("a plugin can store at most %d keys", MaxStorageKeys)
	}
	if usage.Bytes-previous+int64(len(value)) > MaxStorageBytes {
		return fmt.Errorf("this plugin's storage is full (%d MB)", MaxStorageBytes>>20)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	_, werr := tmp.WriteString(value)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		_ = os.Remove(tmp.Name())
		return errors.Join(werr, cerr)
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// StorageDelete removes key. Missing keys are not an error.
func (m *Manager) StorageDelete(id, scope, key string) error {
	if err := validStorageKey(key); err != nil {
		return err
	}
	dir, err := m.storageDir(id, scope)
	if err != nil {
		return err
	}
	lock := storageLock(id)
	lock.Lock()
	defer lock.Unlock()
	if err := os.Remove(storageFile(dir, key)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// StorageList lists keys in a scope that start with prefix, sorted.
func (m *Manager) StorageList(id, scope, prefix string) ([]StorageEntry, error) {
	if _, err := m.installedBase(id); err != nil {
		return nil, err
	}
	dir, err := m.storageDir(id, scope)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []StorageEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []StorageEntry{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		key, ok := storageKeyOf(entry.Name())
		if !ok || !strings.HasPrefix(key, prefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, StorageEntry{Key: key, Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

// StorageClear removes every key in a scope that starts with prefix and
// returns how many were removed.
func (m *Manager) StorageClear(id, scope, prefix string) (int, error) {
	list, err := m.StorageList(id, scope, prefix)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range list {
		if err := m.StorageDelete(id, scope, entry.Key); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

// StorageUsage totals every scope of a plugin's storage.
func (m *Manager) StorageUsage(id string) (StorageUsage, error) {
	lock := storageLock(id)
	lock.Lock()
	defer lock.Unlock()
	return m.storageUsageLocked(id)
}

func (m *Manager) storageUsageLocked(id string) (StorageUsage, error) {
	root, err := m.storageRoot(id)
	if err != nil {
		return StorageUsage{}, err
	}
	usage := StorageUsage{MaxBytes: MaxStorageBytes}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return filepath.SkipDir
			}
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		usage.Keys++
		usage.Bytes += info.Size()
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		err = nil
	}
	return usage, err
}

// removeStorage deletes all of a plugin's storage (on uninstall).
func (m *Manager) removeStorage(id string) error {
	root, err := m.storageRoot(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(root)
}

// MaxBundledFileBytes caps one runtime.readFile result.
const MaxBundledFileBytes = 8 << 20

// ReadBundledFile returns a file shipped in the plugin's bundle (templates,
// data, wasm, fonts…). encoding is "text" (UTF-8) or "base64".
func (m *Manager) ReadBundledFile(id, rel, encoding string) (string, error) {
	base, err := m.installedBase(id)
	if err != nil {
		return "", err
	}
	clean := filepath.ToSlash(filepath.Clean("/" + strings.TrimSpace(rel)))[1:]
	if clean == "" || strings.HasPrefix(clean, ".") || strings.Contains(clean, "/.") || clean == "settings.json" {
		return "", fmt.Errorf("invalid file path")
	}
	path := filepath.Join(base, filepath.FromSlash(clean))
	if r, err := filepath.Rel(base, path); err != nil || strings.HasPrefix(r, "..") {
		return "", fmt.Errorf("invalid file path")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not in the plugin bundle", clean)
	}
	if info.Size() > MaxBundledFileBytes {
		return "", fmt.Errorf("%s is larger than %d MB", clean, MaxBundledFileBytes>>20)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	switch encoding {
	case "", "text":
		return string(data), nil
	case "base64":
		return base64.StdEncoding.EncodeToString(data), nil
	}
	return "", fmt.Errorf("encoding must be text or base64")
}
