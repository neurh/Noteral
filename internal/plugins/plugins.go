// Package plugins implements the local plugin registry, validated bundle
// installation, permission declarations, and the explicit catalog fetch. Plugin
// JavaScript is never executed here; the webview host runs it in a sandbox.
package plugins

import (
	"archive/zip"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"noteral/internal/datadir"
	"noteral/internal/store"
)

//go:embed catalog
var catalogFS embed.FS

const (
	maxBundleBytes = 20 << 20
	maxEntryBytes  = 5 << 20
	maxBundleFiles = 400
	maxEntrySource = 2 << 20
	sdkMajor       = 1
)

// Manifest is the versioned plugin contract.
type Manifest struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Version     string        `json:"version"`
	SDKVersion  string        `json:"sdkVersion"`
	Description string        `json:"description,omitempty"`
	Author      string        `json:"author,omitempty"`
	Entry       string        `json:"entry"`
	Permissions []string      `json:"permissions"`
	Contributes Contributions `json:"contributes"`
}

// Contributions declares the UI surfaces a plugin may populate.
type Contributions struct {
	Commands    []CommandContribution `json:"commands,omitempty"`
	StatusItems []StatusContribution  `json:"statusItems,omitempty"`
	Panels      []PanelContribution   `json:"panels,omitempty"`
}

// CommandContribution is a command palette/slash-menu entry.
type CommandContribution struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Keywords    string `json:"keywords,omitempty"`
}

// StatusContribution is a status-bar item.
type StatusContribution struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// PanelContribution is a small read-only panel in the inspector.
type PanelContribution struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// Info is the installed plugin view.
type Info struct {
	Manifest    Manifest `json:"manifest"`
	Enabled     bool     `json:"enabled"`
	InstalledAt string   `json:"installedAt"`
	Source      string   `json:"source"`
	Problem     string   `json:"problem,omitempty"`
}

// Runtime is the trusted-host view used to create a sandboxed iframe.
type Runtime struct {
	ID       string   `json:"id"`
	Code     string   `json:"code"`
	Manifest Manifest `json:"manifest"`
}

// CatalogEntry is a catalog/plugin listing.
type CatalogEntry struct {
	Manifest  Manifest `json:"manifest"`
	Installed bool     `json:"installed"`
	Enabled   bool     `json:"enabled"`
	Remote    bool     `json:"remote,omitempty"`
	Source    string   `json:"source,omitempty"`
}

// CatalogFile is the on-disk/remote catalog wire format.
type CatalogFile struct {
	Version int        `json:"version"`
	Plugins []Manifest `json:"plugins"`
}

// Manager is the plugin registry.
type Manager struct {
	store *store.Store
	info  datadir.Info
}

func New(st *store.Store, info datadir.Info) *Manager {
	return &Manager{store: st, info: info}
}

var (
	idRe      = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$`)
	versionRe = regexp.MustCompile(`^\d+\.\d+\.\d+([0-9A-Za-z.+-]+)?$`)
	cmdIDRe   = regexp.MustCompile(`^[a-z][a-z0-9-]{1,48}$`)
)

var allowedPermissions = map[string]bool{
	"editor.read":     true,
	"editor.write":    true,
	"pages.read":      true,
	"navigation":      true,
	"search.read":     true,
	"ui.status":       true,
	"ui.notify":       true,
	"ui.panel":        true,
	"settings.read":   true,
	"settings.write":  true,
	"assets.read":     true,
	"assets.write":    true,
	"workspaces.read": true,
}

func validateManifest(m Manifest) (Manifest, error) {
	m.ID = strings.TrimSpace(m.ID)
	m.Name = strings.TrimSpace(m.Name)
	m.Version = strings.TrimSpace(m.Version)
	m.SDKVersion = strings.TrimSpace(m.SDKVersion)
	m.Entry = strings.TrimSpace(m.Entry)
	if !idRe.MatchString(m.ID) || len(m.ID) > 100 {
		return m, fmt.Errorf("plugin id must look like com.example.plugin")
	}
	if m.Name == "" || len([]rune(m.Name)) > 80 {
		return m, fmt.Errorf("plugin name is required (max 80 characters)")
	}
	if !versionRe.MatchString(m.Version) {
		return m, fmt.Errorf("plugin version must be semver, e.g. 1.0.0")
	}
	sdk := strings.TrimPrefix(m.SDKVersion, "^")
	if sdk == "" || !strings.HasPrefix(sdk, "1") || (len(sdk) > 1 && sdk[1] != '.' && sdk[1] != '-') {
		return m, fmt.Errorf("plugin requires unsupported SDK %q; this build supports SDK 1.x", m.SDKVersion)
	}
	if m.Entry == "" {
		m.Entry = "plugin.js"
	}
	cleanEntry := path.Clean(strings.ReplaceAll(m.Entry, "\\", "/"))
	if cleanEntry == "." || strings.HasPrefix(cleanEntry, "../") || strings.HasPrefix(cleanEntry, "/") {
		return m, fmt.Errorf("plugin entry must stay inside the bundle")
	}
	m.Entry = cleanEntry
	seen := map[string]bool{}
	for _, p := range m.Permissions {
		if !allowedPermissions[p] {
			return m, fmt.Errorf("unknown permission %q", p)
		}
		if seen[p] {
			return m, fmt.Errorf("duplicate permission %q", p)
		}
		seen[p] = true
	}
	if len(m.Contributes.Commands) > 40 || len(m.Contributes.StatusItems) > 12 || len(m.Contributes.Panels) > 8 {
		return m, fmt.Errorf("plugin contributes too many UI items")
	}
	cmdSeen := map[string]bool{}
	for i := range m.Contributes.Commands {
		c := &m.Contributes.Commands[i]
		c.ID = strings.TrimSpace(c.ID)
		c.Title = strings.TrimSpace(c.Title)
		if !cmdIDRe.MatchString(c.ID) {
			return m, fmt.Errorf("invalid command id %q", c.ID)
		}
		if c.Title == "" {
			return m, fmt.Errorf("command %q needs a title", c.ID)
		}
		if cmdSeen[c.ID] {
			return m, fmt.Errorf("duplicate command id %q", c.ID)
		}
		cmdSeen[c.ID] = true
	}
	statusSeen := map[string]bool{}
	for i := range m.Contributes.StatusItems {
		s := &m.Contributes.StatusItems[i]
		s.ID = strings.TrimSpace(s.ID)
		s.Label = strings.TrimSpace(s.Label)
		if !cmdIDRe.MatchString(s.ID) || s.Label == "" {
			return m, fmt.Errorf("invalid status item")
		}
		if statusSeen[s.ID] {
			return m, fmt.Errorf("duplicate status item %q", s.ID)
		}
		statusSeen[s.ID] = true
	}
	panelSeen := map[string]bool{}
	for i := range m.Contributes.Panels {
		panel := &m.Contributes.Panels[i]
		panel.ID = strings.TrimSpace(panel.ID)
		panel.Title = strings.TrimSpace(panel.Title)
		if !cmdIDRe.MatchString(panel.ID) || panel.Title == "" {
			return m, fmt.Errorf("invalid panel")
		}
		if panelSeen[panel.ID] {
			return m, fmt.Errorf("duplicate panel %q", panel.ID)
		}
		panelSeen[panel.ID] = true
	}
	return m, nil
}

func parseManifest(data []byte) (Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&m); err != nil {
		return m, fmt.Errorf("plugin.json is not valid JSON: %w", err)
	}
	return validateManifest(m)
}

// List scans installed plugin directories and merges enabled state.
func (m *Manager) List() ([]Info, error) {
	entries, err := os.ReadDir(m.info.PluginsDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Info{}, nil
		}
		return nil, err
	}
	states, err := m.states()
	if err != nil {
		return nil, err
	}
	out := make([]Info, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		info, err := m.readInstalled(e.Name(), states)
		if err != nil {
			out = append(out, Info{Manifest: Manifest{ID: e.Name(), Name: e.Name()}, Problem: err.Error()})
			continue
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Manifest.Name) < strings.ToLower(out[j].Manifest.Name)
	})
	return out, nil
}

func (m *Manager) readInstalled(dir string, states map[string]pluginState) (Info, error) {
	base := filepath.Join(m.info.PluginsDir, dir)
	data, err := os.ReadFile(filepath.Join(base, "plugin.json"))
	if err != nil {
		return Info{}, fmt.Errorf("missing plugin.json")
	}
	manifest, err := parseManifest(data)
	if err != nil {
		return Info{}, err
	}
	if manifest.ID != dir {
		return Info{}, fmt.Errorf("folder name does not match plugin id")
	}
	st := states[manifest.ID]
	return Info{Manifest: manifest, Enabled: st.enabled, InstalledAt: st.installedAt, Source: st.source}, nil
}

type pluginState struct {
	enabled     bool
	installedAt string
	source      string
}

func (m *Manager) states() (map[string]pluginState, error) {
	rows, err := m.store.AppDB().Query(`SELECT id,enabled,installed_at,source FROM plugin_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]pluginState{}
	for rows.Next() {
		var id string
		var enabled int
		var installed, source string
		if err := rows.Scan(&id, &enabled, &installed, &source); err != nil {
			return nil, err
		}
		out[id] = pluginState{enabled: enabled != 0, installedAt: installed, source: source}
	}
	return out, rows.Err()
}

// Toggle enables or disables an installed plugin.
func (m *Manager) Toggle(id string, enabled bool) (Info, error) {
	if !idRe.MatchString(id) {
		return Info{}, fmt.Errorf("invalid plugin id")
	}
	base := filepath.Join(m.info.PluginsDir, id)
	data, err := os.ReadFile(filepath.Join(base, "plugin.json"))
	if err != nil {
		return Info{}, fmt.Errorf("plugin is not installed")
	}
	manifest, err := parseManifest(data)
	if err != nil {
		return Info{}, err
	}
	if enabled {
		if _, err := os.Stat(filepath.Join(base, filepath.FromSlash(manifest.Entry))); err != nil {
			return Info{}, fmt.Errorf("plugin entry is missing")
		}
	}
	states, _ := m.states()
	st := states[id]
	if st.installedAt == "" {
		st.installedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	_, err = m.store.AppDB().Exec(`INSERT INTO plugin_state(id,version,enabled,installed_at,source) VALUES(?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled`, manifest.ID, manifest.Version, boolInt(enabled), st.installedAt, st.source)
	if err != nil {
		return Info{}, err
	}
	return Info{Manifest: manifest, Enabled: enabled, InstalledAt: st.installedAt, Source: st.source}, nil
}

// Uninstall removes a plugin folder and its state.
func (m *Manager) Uninstall(id string) error {
	if !idRe.MatchString(id) {
		return fmt.Errorf("invalid plugin id")
	}
	base := filepath.Join(m.info.PluginsDir, id)
	if err := os.RemoveAll(base); err != nil {
		return err
	}
	_, err := m.store.AppDB().Exec(`DELETE FROM plugin_state WHERE id=?`, id)
	return err
}

// GetSettings returns the plugin's isolated settings object.
func (m *Manager) GetSettings(id string) (map[string]any, error) {
	base, err := m.installedBase(id)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(base, "settings.json"))
	if errors.Is(err, os.ErrNotExist) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("plugin settings are unreadable")
	}
	return out, nil
}

// SaveSettings merges a small JSON object into the plugin's settings file.
func (m *Manager) SaveSettings(id string, patch map[string]any) (map[string]any, error) {
	base, err := m.installedBase(id)
	if err != nil {
		return nil, err
	}
	if len(patch) > 64 {
		return nil, fmt.Errorf("too many settings keys")
	}
	current, err := m.GetSettings(id)
	if err != nil {
		return nil, err
	}
	for k, v := range patch {
		if len(k) > 80 {
			return nil, fmt.Errorf("settings key is too long")
		}
		current[k] = v
	}
	data, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return nil, err
	}
	if len(data) > 64<<10 {
		return nil, fmt.Errorf("plugin settings are too large")
	}
	tmp := filepath.Join(base, ".settings.json.tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, filepath.Join(base, "settings.json")); err != nil {
		return nil, err
	}
	return current, nil
}

func (m *Manager) installedBase(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid plugin id")
	}
	base := filepath.Join(m.info.PluginsDir, id)
	if _, err := os.Stat(filepath.Join(base, "plugin.json")); err != nil {
		return "", fmt.Errorf("plugin is not installed")
	}
	return base, nil
}

// Runtime returns plugin source only for enabled, valid plugins.
func (m *Manager) Runtime(id string) (Runtime, error) {
	if !idRe.MatchString(id) {
		return Runtime{}, fmt.Errorf("invalid plugin id")
	}
	states, err := m.states()
	if err != nil {
		return Runtime{}, err
	}
	st, ok := states[id]
	if !ok || !st.enabled {
		return Runtime{}, fmt.Errorf("plugin is not enabled")
	}
	base := filepath.Join(m.info.PluginsDir, id)
	data, err := os.ReadFile(filepath.Join(base, "plugin.json"))
	if err != nil {
		return Runtime{}, fmt.Errorf("plugin is unavailable")
	}
	manifest, err := parseManifest(data)
	if err != nil {
		return Runtime{}, err
	}
	entry := filepath.Join(base, filepath.FromSlash(manifest.Entry))
	rel, err := filepath.Rel(base, entry)
	if err != nil || strings.HasPrefix(rel, "..") {
		return Runtime{}, fmt.Errorf("invalid plugin entry")
	}
	code, err := os.ReadFile(entry)
	if err != nil {
		return Runtime{}, fmt.Errorf("plugin entry is missing")
	}
	if len(code) > maxEntrySource {
		return Runtime{}, fmt.Errorf("plugin entry is too large")
	}
	return Runtime{ID: id, Code: string(code), Manifest: manifest}, nil
}

// InstallFromZip validates and installs a local bundle in a disabled state.
func (m *Manager) InstallFromZip(zipPath string) (Info, error) {
	abs, err := filepath.Abs(zipPath)
	if err != nil {
		return Info{}, err
	}
	zr, err := zip.OpenReader(abs)
	if err != nil {
		return Info{}, fmt.Errorf("open plugin bundle: %w", err)
	}
	defer zr.Close()
	files, err := readZipFiles(zr.File)
	if err != nil {
		return Info{}, err
	}
	return m.installFiles(files, "local:"+filepath.Base(abs), false)
}

func readZipFiles(zf []*zip.File) (map[string][]byte, error) {
	if len(zf) > maxBundleFiles {
		return nil, fmt.Errorf("plugin bundle has too many files")
	}
	var total int64
	files := map[string][]byte{}
	for _, f := range zf {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if strings.HasPrefix(name, "__MACOSX/") || strings.HasSuffix(name, ".DS_Store") {
			continue
		}
		clean := path.Clean(name)
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(clean, "/../") {
			return nil, fmt.Errorf("plugin bundle contains an unsafe path")
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("plugin bundle contains a symlink")
		}
		if f.UncompressedSize64 > maxEntryBytes {
			return nil, fmt.Errorf("plugin file %s is too large", clean)
		}
		if total+int64(f.UncompressedSize64) > maxBundleBytes {
			return nil, fmt.Errorf("plugin bundle is too large")
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
		rc.Close()
		if err != nil {
			return nil, err
		}
		if len(data) > maxEntryBytes {
			return nil, fmt.Errorf("plugin file %s is too large", clean)
		}
		total += int64(len(data))
		files[clean] = data
	}
	return files, nil
}

func (m *Manager) installFiles(files map[string][]byte, source string, fromCatalog bool) (Info, error) {
	manifestData, prefix, err := locateManifest(files)
	if err != nil {
		return Info{}, err
	}
	manifest, err := parseManifest(manifestData)
	if err != nil {
		return Info{}, err
	}
	entryRel := path.Join(prefix, manifest.Entry)
	if _, ok := files[entryRel]; !ok {
		return Info{}, fmt.Errorf("plugin entry %q is missing from the bundle", manifest.Entry)
	}
	if _, err := os.Stat(filepath.Join(m.info.PluginsDir, manifest.ID)); err == nil {
		return Info{}, fmt.Errorf("plugin %s is already installed", manifest.ID)
	}
	tmp, err := os.MkdirTemp(m.info.PluginsDir, ".install-*")
	if err != nil {
		return Info{}, err
	}
	defer os.RemoveAll(tmp)
	for name, data := range files {
		if prefix != "" {
			if !strings.HasPrefix(name, prefix+"/") {
				continue
			}
			name = strings.TrimPrefix(name, prefix+"/")
		}
		if name == "" {
			continue
		}
		clean := path.Clean(strings.ReplaceAll(name, "\\", "/"))
		if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
			return Info{}, fmt.Errorf("unsafe plugin path")
		}
		dest := filepath.Join(tmp, filepath.FromSlash(clean))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return Info{}, err
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return Info{}, err
		}
	}
	finalDir := filepath.Join(m.info.PluginsDir, manifest.ID)
	if err := os.Rename(tmp, finalDir); err != nil {
		return Info{}, fmt.Errorf("install plugin: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = m.store.AppDB().Exec(`INSERT INTO plugin_state(id,version,enabled,installed_at,source) VALUES(?,?,0,?,?)`, manifest.ID, manifest.Version, now, source)
	if err != nil {
		_ = os.RemoveAll(finalDir)
		return Info{}, err
	}
	return Info{Manifest: manifest, Enabled: false, InstalledAt: now, Source: source}, nil
}

func locateManifest(files map[string][]byte) ([]byte, string, error) {
	if data, ok := files["plugin.json"]; ok {
		return data, "", nil
	}
	var candidates []string
	for name := range files {
		if path.Base(name) == "plugin.json" && strings.Count(name, "/") == 1 {
			candidates = append(candidates, name)
		}
	}
	if len(candidates) != 1 {
		return nil, "", fmt.Errorf("plugin bundle must contain plugin.json at its root or inside one top-level folder")
	}
	prefix := path.Dir(candidates[0])
	return files[candidates[0]], prefix, nil
}

// Catalog returns the bundled catalog and merges installation state.
func (m *Manager) Catalog() ([]CatalogEntry, error) {
	entries, err := readEmbeddedCatalog()
	if err != nil {
		return nil, err
	}
	states, _ := m.states()
	out := make([]CatalogEntry, 0, len(entries))
	for _, man := range entries {
		st := states[man.ID]
		out = append(out, CatalogEntry{Manifest: man, Installed: st.installedAt != "", Enabled: st.enabled, Source: "catalog"})
	}
	return out, nil
}

func readEmbeddedCatalog() ([]Manifest, error) {
	data, err := catalogFS.ReadFile("catalog/catalog.json")
	if err != nil {
		return nil, err
	}
	var cf CatalogFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return nil, fmt.Errorf("bundled catalog is invalid: %w", err)
	}
	for i := range cf.Plugins {
		m, err := validateManifest(cf.Plugins[i])
		if err != nil {
			return nil, err
		}
		cf.Plugins[i] = m
	}
	return cf.Plugins, nil
}

// InstallCatalog installs one of the bundled example plugins, disabled.
func (m *Manager) InstallCatalog(id string) (Info, error) {
	if !idRe.MatchString(id) {
		return Info{}, fmt.Errorf("invalid plugin id")
	}
	files := map[string][]byte{}
	root := "catalog/plugins/" + id
	err := fsWalk(catalogFS, root, func(name string, data []byte) error {
		rel := strings.TrimPrefix(name, root+"/")
		files[rel] = data
		return nil
	})
	if err != nil {
		return Info{}, fmt.Errorf("example plugin not found")
	}
	return m.installFiles(files, "catalog", true)
}

// FetchRemoteCatalog performs one explicit, bounded catalog request. It never
// installs or executes anything.
func (m *Manager) FetchRemoteCatalog(rawURL string) ([]CatalogEntry, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, fmt.Errorf("enter an http(s) catalog URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch catalog: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("catalog returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if err != nil {
		return nil, err
	}
	var cf CatalogFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return nil, fmt.Errorf("catalog is not valid JSON")
	}
	if len(cf.Plugins) > 100 {
		return nil, fmt.Errorf("catalog has too many entries")
	}
	states, _ := m.states()
	out := make([]CatalogEntry, 0, len(cf.Plugins))
	for _, item := range cf.Plugins {
		man, err := validateManifest(item)
		if err != nil {
			continue
		}
		st := states[man.ID]
		out = append(out, CatalogEntry{Manifest: man, Installed: st.installedAt != "", Enabled: st.enabled, Remote: true, Source: u.Host})
	}
	return out, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func fsWalk(fsys embed.FS, root string, fn func(string, []byte) error) error {
	entries, err := fsys.ReadDir(root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := root + "/" + e.Name()
		if e.IsDir() {
			if err := fsWalk(fsys, name, fn); err != nil {
				return err
			}
			continue
		}
		data, err := fsys.ReadFile(name)
		if err != nil {
			return err
		}
		if err := fn(name, data); err != nil {
			return err
		}
	}
	return nil
}
