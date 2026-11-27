// Package plugins implements the local plugin registry, validated bundle
// installation, permission declarations, and the explicit catalog fetch. Plugin
// JavaScript is never executed here; the webview host runs it in a sandbox.
package plugins

import (
	"archive/zip"
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
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
var embeddedCatalog embed.FS

// catalogFS holds the bundled catalog (catalog/catalog.json and catalog/plugins/<id>/…).
// Noteral currently ships no bundled plugins; tests swap in a fixture.
var catalogFS fs.FS = embeddedCatalog

const (
	maxBundleBytes = 20 << 20
	maxEntryBytes  = 5 << 20
	maxBundleFiles = 400
	maxEntrySource = 2 << 20
	maxStylesBytes = 512 << 10
	// sdkMajorMin..sdkMajorMax are the SDK major versions this host can run.
	// SDK 2 is a superset of SDK 1 on the wire (protocol 1), so 1.x plugins keep working.
	sdkMajorMin = 1
	sdkMajorMax = 2
	// SDKVersion is the newest plugin SDK this host implements.
	SDKVersion = "2.3.0"
)

// ManifestFile and LegacyManifestFile are the two accepted manifest names. New
// plugins ship manifest.json + main.js (+ styles.css) as GitHub Release assets;
// older bundles ship plugin.json + plugin.js. Installed plugins always get a
// normalized plugin.json written next to their files.
const (
	ManifestFile       = "manifest.json"
	LegacyManifestFile = "plugin.json"
	StylesFile         = "styles.css"
)

// Manifest is the versioned plugin contract.
type Manifest struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	SDKVersion string `json:"sdkVersion"`
	// MinAppVersion is the oldest Noteral version the plugin supports.
	MinAppVersion string `json:"minAppVersion,omitempty"`
	Description   string `json:"description,omitempty"`
	Author        string `json:"author,omitempty"`
	AuthorURL     string `json:"authorUrl,omitempty"`
	// Repo is the GitHub "owner/name" the plugin is released from.
	Repo        string        `json:"repo,omitempty"`
	Entry       string        `json:"entry"`
	Permissions []string      `json:"permissions"`
	Contributes Contributions `json:"contributes"`
}

// Contributions declares the UI surfaces a plugin may populate.
type Contributions struct {
	Commands    []CommandContribution `json:"commands,omitempty"`
	StatusItems []StatusContribution  `json:"statusItems,omitempty"`
	Panels      []PanelContribution   `json:"panels,omitempty"`
	// Menus adds items to app menus; choosing one runs one of the plugin's commands.
	Menus []MenuContribution `json:"menus,omitempty"`
	// Settings are options the user edits on the plugin's Options screen.
	Settings []SettingContribution `json:"settings,omitempty"`
}

// MenuContribution is an item in an app menu (page, tree, block, tab or status).
type MenuContribution struct {
	ID         string   `json:"id"`
	Menu       string   `json:"menu"`
	Title      string   `json:"title"`
	Icon       string   `json:"icon,omitempty"`
	Command    string   `json:"command"`
	Kinds      []string `json:"kinds,omitempty"`
	NodeTypes  []string `json:"nodeTypes,omitempty"`
	BlockTypes []string `json:"blockTypes,omitempty"`
	Danger     bool     `json:"danger,omitempty"`
}

// SettingOption is one choice of a "select" setting.
type SettingOption struct {
	Value string `json:"value"`
	Label string `json:"label,omitempty"`
}

// SettingContribution is one user-editable option.
type SettingContribution struct {
	Key         string          `json:"key"`
	Type        string          `json:"type"`
	Label       string          `json:"label,omitempty"`
	Description string          `json:"description,omitempty"`
	Section     string          `json:"section,omitempty"`
	Placeholder string          `json:"placeholder,omitempty"`
	Default     json.RawMessage `json:"default,omitempty"`
	Options     []SettingOption `json:"options,omitempty"`
	Min         *float64        `json:"min,omitempty"`
	Max         *float64        `json:"max,omitempty"`
	Step        *float64        `json:"step,omitempty"`
}

var (
	menuSlots    = map[string]bool{"page": true, "tree": true, "block": true, "tab": true, "status": true, "tabItem": true, "assistant": true, "treeSelection": true}
	settingTypes = map[string]bool{"toggle": true, "text": true, "textarea": true, "number": true, "slider": true, "select": true, "color": true}
	settingKeyRe = regexp.MustCompile(`^[a-zA-Z][\w.-]{0,63}$`)
)

// CommandContribution is a command palette/slash-menu entry.
type CommandContribution struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Keywords    string `json:"keywords,omitempty"`
	// Shortcut is an optional key binding such as "Mod+Shift+K" (Mod = Ctrl or ⌘).
	Shortcut string `json:"shortcut,omitempty"`
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
	Styles   string   `json:"styles,omitempty"`
	Manifest Manifest `json:"manifest"`
}

// CatalogEntry is a catalog/plugin listing.
type CatalogEntry struct {
	Manifest  Manifest `json:"manifest"`
	Installed bool     `json:"installed"`
	Enabled   bool     `json:"enabled"`
	Remote    bool     `json:"remote,omitempty"`
	Source    string   `json:"source,omitempty"`
	// InstalledVersion is set when a (possibly older) copy is installed.
	InstalledVersion string `json:"installedVersion,omitempty"`
}

// CatalogFile is the on-disk/remote catalog wire format.
type CatalogFile struct {
	Version int        `json:"version"`
	Plugins []Manifest `json:"plugins"`
}

// Manager is the plugin registry.
type Manager struct {
	store      *store.Store
	info       datadir.Info
	appVersion string
	http       *http.Client
	githubBase string
	githubAPI  string
}

func New(st *store.Store, info datadir.Info) *Manager {
	return &Manager{
		store:      st,
		info:       info,
		appVersion: "0.0.0",
		http:       &http.Client{Timeout: 30 * time.Second},
		githubBase: envOr("NOTERAL_GITHUB_BASE", "https://github.com"),
		githubAPI:  envOr("NOTERAL_GITHUB_API", "https://api.github.com"),
	}
}

// envOr lets a GitHub mirror (or a local mock while testing a registry) stand
// in for github.com, e.g. NOTERAL_GITHUB_API=http://localhost:9912.
func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// SetAppVersion tells the manager which Noteral version is running so
// minAppVersion can be enforced.
func (m *Manager) SetAppVersion(v string) {
	if versionRe.MatchString(v) {
		m.appVersion = v
	}
}

// AppVersion returns the running Noteral version used for compatibility checks.
func (m *Manager) AppVersion() string { return m.appVersion }

var (
	idRe      = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$`)
	versionRe = regexp.MustCompile(`^\d+\.\d+\.\d+([0-9A-Za-z.+-]+)?$`)
	cmdIDRe   = regexp.MustCompile(`^[a-z][a-z0-9-]{1,48}$`)
	repoRe    = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$`)
)

// allowedPermissions is the closed permission vocabulary. Keep it in sync with
// PERMISSIONS in frontend/src/sdk-host/spec.ts (docs: docs/sdk/api-reference.md).
var allowedPermissions = map[string]bool{
	"editor.read":      true,
	"editor.write":     true,
	"pages.read":       true,
	"pages.write":      true,
	"databases.read":   true,
	"databases.write":  true,
	"navigation":       true,
	"search.read":      true,
	"ui.status":        true,
	"ui.notify":        true,
	"ui.panel":         true,
	"ui.modal":         true,
	"ui.overlay":       true,
	"ui.styles":        true,
	"settings.read":    true,
	"settings.write":   true,
	"assets.read":      true,
	"assets.write":     true,
	"workspaces.read":  true,
	"workspaces.write": true,
	"layout":           true,
	"appearance":       true,
	"preferences":      true,
	"commands.execute": true,
	"clipboard":        true,
	"network":          true,
	"network.local":    true,
	"blocks":           true,
	"nodes":            true,
	"home":             true,
	"menus":            true,
}

// AllowedPermissions returns the sorted permission vocabulary.
func AllowedPermissions() []string {
	out := make([]string, 0, len(allowedPermissions))
	for p := range allowedPermissions {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func validateManifest(m Manifest) (Manifest, error) {
	m.ID = strings.TrimSpace(m.ID)
	m.Name = strings.TrimSpace(m.Name)
	m.Version = strings.TrimSpace(m.Version)
	m.SDKVersion = strings.TrimSpace(m.SDKVersion)
	m.Entry = strings.TrimSpace(m.Entry)
	m.MinAppVersion = strings.TrimSpace(m.MinAppVersion)
	m.Repo = strings.TrimSpace(m.Repo)
	if !idRe.MatchString(m.ID) || len(m.ID) > 100 {
		return m, fmt.Errorf("plugin id must look like com.example.plugin")
	}
	if m.Name == "" || len([]rune(m.Name)) > 80 {
		return m, fmt.Errorf("plugin name is required (max 80 characters)")
	}
	if !versionRe.MatchString(m.Version) {
		return m, fmt.Errorf("plugin version must be semver, e.g. 1.0.0")
	}
	if m.SDKVersion == "" {
		m.SDKVersion = SDKVersion
	}
	major, ok := sdkMajor(m.SDKVersion)
	if !ok || major < sdkMajorMin || major > sdkMajorMax {
		return m, fmt.Errorf("plugin requires unsupported SDK %q; this build supports SDK 1.x and 2.x", m.SDKVersion)
	}
	if m.MinAppVersion != "" && !versionRe.MatchString(m.MinAppVersion) {
		return m, fmt.Errorf("minAppVersion must be semver, e.g. 0.1.0")
	}
	if m.Repo != "" && !repoRe.MatchString(m.Repo) {
		return m, fmt.Errorf("repo must look like owner/name")
	}
	if len([]rune(m.Description)) > 500 {
		return m, fmt.Errorf("plugin description is too long (max 500 characters)")
	}
	if m.Permissions == nil {
		m.Permissions = []string{}
	}
	if m.Entry == "" {
		m.Entry = "main.js"
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
		c.Shortcut = strings.TrimSpace(c.Shortcut)
		if len(c.Shortcut) > 40 {
			return m, fmt.Errorf("command %q has a shortcut longer than 40 characters", c.ID)
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
	if len(m.Contributes.Menus) > 24 || len(m.Contributes.Settings) > 40 {
		return m, fmt.Errorf("plugin contributes too many menu items or settings")
	}
	menuSeen := map[string]bool{}
	for i := range m.Contributes.Menus {
		item := &m.Contributes.Menus[i]
		item.ID = strings.TrimSpace(item.ID)
		item.Title = strings.TrimSpace(item.Title)
		item.Command = strings.TrimSpace(item.Command)
		if !cmdIDRe.MatchString(item.ID) || item.Title == "" || !menuSlots[item.Menu] || !cmdIDRe.MatchString(item.Command) {
			return m, fmt.Errorf("invalid menu item %q (needs id, title, a menu of page/tree/block/tab/status and a command id)", item.ID)
		}
		if menuSeen[item.ID] {
			return m, fmt.Errorf("duplicate menu item %q", item.ID)
		}
		menuSeen[item.ID] = true
	}
	settingSeen := map[string]bool{}
	for i := range m.Contributes.Settings {
		field := &m.Contributes.Settings[i]
		field.Key = strings.TrimSpace(field.Key)
		if !settingKeyRe.MatchString(field.Key) || !settingTypes[field.Type] {
			return m, fmt.Errorf("invalid setting %q (needs a key and a type of toggle/text/textarea/number/slider/select/color)", field.Key)
		}
		if field.Type == "select" && len(field.Options) == 0 {
			return m, fmt.Errorf("setting %q is a select and needs options", field.Key)
		}
		if settingSeen[field.Key] {
			return m, fmt.Errorf("duplicate setting %q", field.Key)
		}
		settingSeen[field.Key] = true
	}
	return m, nil
}

func parseManifest(data []byte) (Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&m); err != nil {
		return m, fmt.Errorf("manifest is not valid JSON: %w", err)
	}
	return validateManifest(m)
}

// parseNamedManifest applies the per-file entry default: plugin.json bundles
// historically defaulted to plugin.js, manifest.json releases to main.js.
func parseNamedManifest(name string, data []byte) (Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return m, fmt.Errorf("%s is not valid JSON: %w", name, err)
	}
	if strings.TrimSpace(m.Entry) == "" && path.Base(name) == LegacyManifestFile {
		m.Entry = "plugin.js"
	}
	return validateManifest(m)
}

func sdkMajor(v string) (int, bool) {
	v = strings.TrimLeft(strings.TrimSpace(v), "^~>=v")
	if v == "" {
		return 0, false
	}
	end := strings.IndexAny(v, ".-")
	if end < 0 {
		end = len(v)
	}
	n := 0
	for _, r := range v[:end] {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
	}
	return n, end > 0
}

// CompareVersions compares two semver strings (major.minor.patch with an
// optional pre-release). It returns -1, 0 or 1.
func CompareVersions(a, b string) int {
	pa, preA := splitVersion(a)
	pb, preB := splitVersion(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case preA == preB:
		return 0
	case preA == "":
		return 1
	case preB == "":
		return -1
	case preA < preB:
		return -1
	default:
		return 1
	}
}

func splitVersion(v string) ([3]int, string) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		pre = v[i+1:]
		v = v[:i]
	}
	parts := strings.SplitN(v, ".", 3)
	for i := 0; i < len(parts) && i < 3; i++ {
		n := 0
		for _, r := range parts[i] {
			if r < '0' || r > '9' {
				break
			}
			n = n*10 + int(r-'0')
		}
		out[i] = n
	}
	return out, pre
}

// compatibility returns a human-readable problem when the running app is older
// than the plugin's minAppVersion.
func (m *Manager) compatibility(man Manifest) string {
	if man.MinAppVersion != "" && CompareVersions(m.appVersion, man.MinAppVersion) < 0 {
		return fmt.Sprintf("requires Noteral %s or newer (this is %s)", man.MinAppVersion, m.appVersion)
	}
	return ""
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
	return Info{Manifest: manifest, Enabled: st.enabled, InstalledAt: st.installedAt, Source: st.source, Problem: m.compatibility(manifest)}, nil
}

type pluginState struct {
	version     string
	enabled     bool
	installedAt string
	source      string
}

func (m *Manager) states() (map[string]pluginState, error) {
	rows, err := m.store.AppDB().Query(`SELECT id,version,enabled,installed_at,source FROM plugin_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]pluginState{}
	for rows.Next() {
		var id, version string
		var enabled int
		var installed, source string
		if err := rows.Scan(&id, &version, &enabled, &installed, &source); err != nil {
			return nil, err
		}
		out[id] = pluginState{version: version, enabled: enabled != 0, installedAt: installed, source: source}
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
		if problem := m.compatibility(manifest); problem != "" {
			return Info{}, fmt.Errorf("cannot enable %s: %s", manifest.Name, problem)
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
	if err := m.removeStorage(id); err != nil {
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
		if v == nil {
			delete(current, k)
			continue
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
	if problem := m.compatibility(manifest); problem != "" {
		return Runtime{}, fmt.Errorf("%s %s", manifest.Name, problem)
	}
	rt := Runtime{ID: id, Code: string(code), Manifest: manifest}
	if css, err := os.ReadFile(filepath.Join(base, StylesFile)); err == nil && len(css) <= maxStylesBytes {
		rt.Styles = string(css)
	}
	return rt, nil
}

// InspectZip validates a local bundle without installing it so the user can
// review its permissions first.
func (m *Manager) InspectZip(zipPath string) (Manifest, error) {
	files, err := m.zipFiles(zipPath)
	if err != nil {
		return Manifest{}, err
	}
	man, _, err := manifestFromFiles(files)
	return man, err
}

// InstallFromZip validates and installs a local bundle in a disabled state.
// approved must contain every permission the manifest declares.
func (m *Manager) InstallFromZip(zipPath string, approved []string) (Info, error) {
	files, err := m.zipFiles(zipPath)
	if err != nil {
		return Info{}, err
	}
	abs, _ := filepath.Abs(zipPath)
	return m.installFiles(files, "local:"+filepath.Base(abs), installOptions{approved: approved, allowUpdate: true, enable: true})
}

func (m *Manager) zipFiles(zipPath string) (map[string][]byte, error) {
	abs, err := filepath.Abs(zipPath)
	if err != nil {
		return nil, err
	}
	zr, err := zip.OpenReader(abs)
	if err != nil {
		return nil, fmt.Errorf("open plugin bundle: %w", err)
	}
	defer zr.Close()
	return readZipFiles(zr.File)
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

type installOptions struct {
	// approved is the permission set the user accepted. Every declared
	// permission must be in it; nil means "not approved".
	approved []string
	// allowUpdate replaces an existing installation (keeping settings.json and
	// the enabled flag) when the incoming version is not older.
	allowUpdate bool
	// allowDowngrade permits replacing with an equal or older version.
	allowDowngrade bool
	// expectedID, when set, must equal the manifest id (registry entries).
	expectedID string
	// enable turns the plugin on after a fresh install.
	enable bool
}

// MissingPermissions returns the declared permissions that are not approved.
func MissingPermissions(declared, approved []string) []string {
	ok := map[string]bool{}
	for _, p := range approved {
		ok[p] = true
	}
	var out []string
	for _, p := range declared {
		if !ok[p] {
			out = append(out, p)
		}
	}
	return out
}

func manifestFromFiles(files map[string][]byte) (Manifest, string, error) {
	name, data, prefix, err := locateManifest(files)
	if err != nil {
		return Manifest{}, "", err
	}
	man, err := parseNamedManifest(name, data)
	if err != nil {
		return Manifest{}, "", err
	}
	return man, prefix, nil
}

func (m *Manager) installFiles(files map[string][]byte, source string, opts installOptions) (Info, error) {
	manifest, prefix, err := manifestFromFiles(files)
	if err != nil {
		return Info{}, err
	}
	if opts.expectedID != "" && manifest.ID != opts.expectedID {
		return Info{}, fmt.Errorf("release manifest id %q does not match the registry id %q", manifest.ID, opts.expectedID)
	}
	if problem := m.compatibility(manifest); problem != "" {
		return Info{}, fmt.Errorf("%s %s", manifest.Name, problem)
	}
	if opts.approved == nil {
		return Info{}, fmt.Errorf("review and approve the plugin's permissions before installing")
	}
	if missing := MissingPermissions(manifest.Permissions, opts.approved); len(missing) > 0 {
		return Info{}, fmt.Errorf("permissions were not approved: %s", strings.Join(missing, ", "))
	}
	entryRel := path.Join(prefix, manifest.Entry)
	if _, ok := files[entryRel]; !ok {
		return Info{}, fmt.Errorf("plugin entry %q is missing from the bundle", manifest.Entry)
	}
	if css, ok := files[path.Join(prefix, StylesFile)]; ok && len(css) > maxStylesBytes {
		return Info{}, fmt.Errorf("styles.css is too large")
	}
	if err := os.MkdirAll(m.info.PluginsDir, 0o755); err != nil {
		return Info{}, err
	}
	finalDir := filepath.Join(m.info.PluginsDir, manifest.ID)
	states, _ := m.states()
	prev, hadState := states[manifest.ID]
	_, statErr := os.Stat(finalDir)
	exists := statErr == nil
	if exists && !opts.allowUpdate {
		return Info{}, fmt.Errorf("plugin %s is already installed", manifest.ID)
	}
	if exists && !opts.allowDowngrade {
		if data, err := os.ReadFile(filepath.Join(finalDir, LegacyManifestFile)); err == nil {
			if old, err := parseManifest(data); err == nil && CompareVersions(manifest.Version, old.Version) < 0 {
				return Info{}, fmt.Errorf("%s %s is older than the installed %s", manifest.Name, manifest.Version, old.Version)
			}
		}
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
		if name == "" || name == "settings.json" {
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
	// Always store a normalized plugin.json so the installed layout is uniform.
	normalized, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Info{}, err
	}
	if err := os.WriteFile(filepath.Join(tmp, LegacyManifestFile), normalized, 0o644); err != nil {
		return Info{}, err
	}
	if exists {
		if data, err := os.ReadFile(filepath.Join(finalDir, "settings.json")); err == nil {
			if err := os.WriteFile(filepath.Join(tmp, "settings.json"), data, 0o600); err != nil {
				return Info{}, err
			}
		}
		old := filepath.Join(m.info.PluginsDir, fmt.Sprintf(".old-%s-%d", manifest.ID, time.Now().UnixNano()))
		if err := os.Rename(finalDir, old); err != nil {
			return Info{}, fmt.Errorf("update plugin: %w", err)
		}
		if err := os.Rename(tmp, finalDir); err != nil {
			_ = os.Rename(old, finalDir)
			return Info{}, fmt.Errorf("update plugin: %w", err)
		}
		_ = os.RemoveAll(old)
	} else if err := os.Rename(tmp, finalDir); err != nil {
		return Info{}, fmt.Errorf("install plugin: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	enabled := opts.enable
	installedAt := now
	if hadState && exists {
		enabled = prev.enabled
		if prev.installedAt != "" {
			installedAt = prev.installedAt
		}
	}
	_, err = m.store.AppDB().Exec(`INSERT INTO plugin_state(id,version,enabled,installed_at,source) VALUES(?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,source=excluded.source`,
		manifest.ID, manifest.Version, boolInt(enabled), installedAt, source)
	if err != nil {
		if !exists {
			_ = os.RemoveAll(finalDir)
		}
		return Info{}, err
	}
	return Info{Manifest: manifest, Enabled: enabled, InstalledAt: installedAt, Source: source}, nil
}

// InstallGenerated installs (or updates) a plugin authored inside Noteral, for
// example by the assistant's Creator mode. It goes through the same validation
// and permission approval as any other bundle. Only plugins whose source is
// "assistant" or "local" may be overwritten this way.
func (m *Manager) InstallGenerated(manifest Manifest, code, styles string, approved []string, source string) (Info, error) {
	if source == "" {
		source = "assistant"
	}
	if source != "assistant" && source != "local" {
		return Info{}, fmt.Errorf("invalid plugin source")
	}
	if manifest.Entry == "" {
		manifest.Entry = "main.js"
	}
	if len(code) == 0 || len(code) > maxEntrySource {
		return Info{}, fmt.Errorf("plugin code is empty or too large")
	}
	states, _ := m.states()
	if st, ok := states[strings.TrimSpace(manifest.ID)]; ok && st.source != "assistant" && !strings.HasPrefix(st.source, "local") {
		return Info{}, fmt.Errorf("plugin %s was installed from %s and cannot be overwritten", manifest.ID, st.source)
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		return Info{}, err
	}
	files := map[string][]byte{ManifestFile: data}
	entry := path.Clean(strings.TrimSpace(manifest.Entry))
	files[entry] = []byte(code)
	if strings.TrimSpace(styles) != "" {
		files[StylesFile] = []byte(styles)
	}
	return m.installFiles(files, source, installOptions{approved: approved, allowUpdate: true, allowDowngrade: true, enable: true})
}

// Source returns a plugin's installed source and files for inspection (used by
// the assistant to edit plugins it created).
func (m *Manager) Source(id string) (Manifest, string, string, error) {
	base, err := m.installedBase(id)
	if err != nil {
		return Manifest{}, "", "", err
	}
	data, err := os.ReadFile(filepath.Join(base, LegacyManifestFile))
	if err != nil {
		return Manifest{}, "", "", err
	}
	man, err := parseManifest(data)
	if err != nil {
		return Manifest{}, "", "", err
	}
	code, err := os.ReadFile(filepath.Join(base, filepath.FromSlash(man.Entry)))
	if err != nil {
		return Manifest{}, "", "", fmt.Errorf("plugin entry is missing")
	}
	css, _ := os.ReadFile(filepath.Join(base, StylesFile))
	return man, string(code), string(css), nil
}

func locateManifest(files map[string][]byte) (string, []byte, string, error) {
	for _, name := range []string{ManifestFile, LegacyManifestFile} {
		if data, ok := files[name]; ok {
			return name, data, "", nil
		}
	}
	for _, want := range []string{ManifestFile, LegacyManifestFile} {
		var candidates []string
		for name := range files {
			if path.Base(name) == want && strings.Count(name, "/") == 1 {
				candidates = append(candidates, name)
			}
		}
		if len(candidates) == 1 {
			return candidates[0], files[candidates[0]], path.Dir(candidates[0]), nil
		}
		if len(candidates) > 1 {
			break
		}
	}
	return "", nil, "", fmt.Errorf("plugin bundle must contain manifest.json (or plugin.json) at its root or inside one top-level folder")
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
		out = append(out, CatalogEntry{Manifest: man, Installed: st.installedAt != "", Enabled: st.enabled, Source: "catalog", InstalledVersion: st.version})
	}
	return out, nil
}

func readEmbeddedCatalog() ([]Manifest, error) {
	data, err := fs.ReadFile(catalogFS, "catalog/catalog.json")
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

// InstallCatalog installs one of the bundled plugins after permission approval.
func (m *Manager) InstallCatalog(id string, approved []string) (Info, error) {
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
	return m.installFiles(files, "catalog", installOptions{approved: approved, allowUpdate: true, expectedID: id, enable: true})
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func fsWalk(fsys fs.FS, root string, fn func(string, []byte) error) error {
	entries, err := fs.ReadDir(fsys, root)
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
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		if err := fn(name, data); err != nil {
			return err
		}
	}
	return nil
}
