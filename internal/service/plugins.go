package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	"noteral/internal/plugins"
)

// pendingZips holds plugin bundles the user picked but has not approved yet.
// The renderer only ever sees an opaque token, never a filesystem path it could
// swap for another one.
var pendingZips = struct {
	sync.Mutex
	paths map[string]string
}{paths: map[string]string{}}

// PickedPlugin describes a local bundle awaiting permission approval.
type PickedPlugin struct {
	Token    string           `json:"token"`
	Manifest plugins.Manifest `json:"manifest"`
	// InstalledVersion is set when the bundle would update an installed plugin.
	InstalledVersion string `json:"installedVersion"`
	Problem          string `json:"problem"`
}

// PluginEnvironment tells the store which host it is talking to.
type PluginEnvironment struct {
	AppVersion         string   `json:"appVersion"`
	SDKVersion         string   `json:"sdkVersion"`
	DefaultRegistryURL string   `json:"defaultRegistryUrl"`
	AllowedPermissions []string `json:"allowedPermissions"`
	PluginsDirectory   string   `json:"pluginsDirectory"`
}

func (s *AppService) GetPluginEnvironment() PluginEnvironment {
	return PluginEnvironment{
		AppVersion:         Version,
		SDKVersion:         plugins.SDKVersion,
		DefaultRegistryURL: plugins.DefaultRegistryURL,
		AllowedPermissions: plugins.AllowedPermissions(),
		PluginsDirectory:   s.info.PluginsDir,
	}
}

// GetPluginSettings returns an enabled plugin's own settings object.
func (s *AppService) GetPluginSettings(id string) (map[string]any, error) {
	return s.plugins.GetSettings(id)
}

// SavePluginSettings merges a plugin's own settings object.
func (s *AppService) SavePluginSettings(id string, patch map[string]any) (map[string]any, error) {
	return s.plugins.SaveSettings(id, patch)
}

func (s *AppService) ListPlugins() ([]plugins.Info, error) { return s.plugins.List() }

func (s *AppService) TogglePlugin(id string, enabled bool) (plugins.Info, error) {
	return s.plugins.Toggle(id, enabled)
}

func (s *AppService) UninstallPlugin(id string) error { return s.plugins.Uninstall(id) }

// PickPluginBundle opens a file dialog and inspects the chosen zip without
// installing it. Returns an empty token when the user cancels.
func (s *AppService) PickPluginBundle() (PickedPlugin, error) {
	if s.app == nil {
		return PickedPlugin{}, fmt.Errorf("dialogs are unavailable")
	}
	path, err := s.app.Dialog.OpenFile().
		SetTitle("Install a plugin bundle").
		AddFilter("Noteral plugin", "*.zip").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return PickedPlugin{}, err
	}
	man, err := s.plugins.InspectZip(path)
	if err != nil {
		return PickedPlugin{}, err
	}
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	token := hex.EncodeToString(buf)
	pendingZips.Lock()
	pendingZips.paths[token] = path
	pendingZips.Unlock()
	picked := PickedPlugin{Token: token, Manifest: man}
	if list, err := s.plugins.List(); err == nil {
		for _, p := range list {
			if p.Manifest.ID == man.ID {
				picked.InstalledVersion = p.Manifest.Version
			}
		}
	}
	if man.MinAppVersion != "" && plugins.CompareVersions(Version, man.MinAppVersion) < 0 {
		picked.Problem = fmt.Sprintf("requires Noteral %s or newer (this is %s)", man.MinAppVersion, Version)
	}
	return picked, nil
}

// InstallPluginBundle installs a previously picked bundle after the user
// approved exactly the listed permissions.
func (s *AppService) InstallPluginBundle(token string, approved []string) (plugins.Info, error) {
	pendingZips.Lock()
	path, ok := pendingZips.paths[token]
	delete(pendingZips.paths, token)
	pendingZips.Unlock()
	if !ok {
		return plugins.Info{}, fmt.Errorf("that bundle is no longer pending; pick it again")
	}
	return s.plugins.InstallFromZip(path, approved)
}

func (s *AppService) ListPluginCatalog() ([]plugins.CatalogEntry, error) {
	return s.plugins.Catalog()
}

func (s *AppService) InstallCatalogPlugin(id string, approved []string) (plugins.Info, error) {
	return s.plugins.InstallCatalog(id, approved)
}

// FetchCommunityRegistry downloads community-plugins.json. An empty URL uses
// the default GitHub-hosted registry.
func (s *AppService) FetchCommunityRegistry(rawURL string) (plugins.RegistryResult, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		rawURL = plugins.DefaultRegistryURL
	}
	return s.plugins.FetchRegistry(rawURL)
}

// GetCommunityRelease reads the latest GitHub Release of a plugin repository.
func (s *AppService) GetCommunityRelease(repo, expectedID string) (plugins.Release, error) {
	return s.plugins.FetchRelease(repo, expectedID)
}

// InstallCommunityPlugin installs or updates a plugin from its latest release.
func (s *AppService) InstallCommunityPlugin(repo, expectedID string, approved []string) (plugins.Info, error) {
	return s.plugins.InstallFromGitHub(repo, expectedID, approved)
}

// CheckPluginUpdates compares GitHub-installed plugins to their latest release.
func (s *AppService) CheckPluginUpdates() ([]plugins.Update, error) {
	return s.plugins.CheckUpdates()
}

// GetPluginSource returns an installed plugin's manifest, code and styles —
// used by the assistant to read and revise plugins it created.
type PluginSource struct {
	Manifest plugins.Manifest `json:"manifest"`
	Code     string           `json:"code"`
	Styles   string           `json:"styles"`
}

func (s *AppService) GetPluginSource(id string) (PluginSource, error) {
	man, code, css, err := s.plugins.Source(id)
	if err != nil {
		return PluginSource{}, err
	}
	return PluginSource{Manifest: man, Code: code, Styles: css}, nil
}

// InstallGeneratedPlugin installs a single-file plugin written in-app (by the
// assistant or the developer console). The user approved `approved` in the UI.
func (s *AppService) InstallGeneratedPlugin(manifest plugins.Manifest, code, styles string, approved []string) (plugins.Info, error) {
	return s.plugins.InstallGenerated(manifest, code, styles, approved, "assistant")
}

func (s *AppService) GetPluginRuntime(id string) (plugins.Runtime, error) {
	return s.plugins.Runtime(id)
}
