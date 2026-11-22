// Package service exposes the narrow, typed Go API that the React renderer
// consumes through generated Wails bindings.
package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"noteral/internal/assets"
	"noteral/internal/blocknote"
	"noteral/internal/datadir"
	"noteral/internal/plugins"
	"noteral/internal/store"
)

// Version is the application version displayed in Settings/About.
const Version = "0.1.0"

// AppService is bound to the webview.
type AppService struct {
	store   *store.Store
	assets  *assets.Manager
	plugins *plugins.Manager
	info    datadir.Info
	app     *application.App
	flush   chan struct{}
	once    sync.Once
}

func New(st *store.Store, am *assets.Manager, pm *plugins.Manager, info datadir.Info) *AppService {
	return &AppService{store: st, assets: am, plugins: pm, info: info, flush: make(chan struct{})}
}

// SetApp is called immediately after application.New so dialogs can be shown.
func (s *AppService) SetApp(app *application.App) { s.app = app }

// Bootstrap is called once at startup.
type Bootstrap struct {
	AppName       string            `json:"appName"`
	Version       string            `json:"version"`
	DataDir       string            `json:"dataDir"`
	Platform      string            `json:"platform"`
	Workspaces    []store.Workspace `json:"workspaces"`
	LastWorkspace string            `json:"lastWorkspaceId"`
	Settings      store.AppSettings `json:"settings"`
	DataWritable  bool              `json:"dataWritable"`
}

func (s *AppService) Bootstrap() (Bootstrap, error) {
	ws, err := s.store.ListWorkspaces()
	if err != nil {
		return Bootstrap{}, err
	}
	return Bootstrap{
		AppName:       "Noteral",
		Version:       Version,
		DataDir:       s.info.Root,
		Platform:      runtime.GOOS,
		Workspaces:    ws,
		LastWorkspace: s.store.LastWorkspaceID(),
		Settings:      s.store.GetAppSettings(),
		DataWritable:  true,
	}, nil
}

func (s *AppService) ListWorkspaces() ([]store.Workspace, error) {
	return s.store.ListWorkspaces()
}

func (s *AppService) CreateWorkspace(name string) (store.WorkspaceSnapshot, error) {
	w, err := s.store.CreateWorkspace(name)
	if err != nil {
		return store.WorkspaceSnapshot{}, err
	}
	return s.store.Snapshot(w.ID)
}

func (s *AppService) RenameWorkspace(id, name string) (store.Workspace, error) {
	return s.store.RenameWorkspace(id, name)
}

// OpenWorkspace switches the active workspace and returns its page tree plus
// per-workspace UI state. Document bodies remain lazy.
func (s *AppService) OpenWorkspace(id string) (store.WorkspaceSnapshot, error) {
	return s.store.Snapshot(id)
}

func (s *AppService) OpenPage(workspaceID, pageID string) (store.PageDocument, error) {
	return s.store.OpenPage(workspaceID, pageID)
}

func (s *AppService) CreatePage(workspaceID, parentID string) (store.PageDocument, error) {
	return s.store.CreatePage(workspaceID, parentID)
}

func (s *AppService) RenamePage(workspaceID, pageID, title string) (store.PageMeta, error) {
	return s.store.RenamePage(workspaceID, pageID, title)
}

func (s *AppService) SetPageAppearance(workspaceID, pageID, icon, cover string) (store.PageMeta, error) {
	return s.store.SetPageAppearance(workspaceID, pageID, icon, cover)
}

// DuplicateResult is the new page plus the refreshed shell state.
type DuplicateResult struct {
	PageID   string                  `json:"pageId"`
	Snapshot store.WorkspaceSnapshot `json:"snapshot"`
}

// DeletePage is kept for older renderers; it now moves the page to the trash
// rather than removing it permanently.
func (s *AppService) DeletePage(workspaceID, pageID string) (store.WorkspaceSnapshot, error) {
	return s.TrashPage(workspaceID, pageID)
}

func (s *AppService) TrashPage(workspaceID, pageID string) (store.WorkspaceSnapshot, error) {
	if err := s.store.TrashPage(workspaceID, pageID); err != nil {
		return store.WorkspaceSnapshot{}, err
	}
	return s.store.Snapshot(workspaceID)
}

func (s *AppService) RestorePage(workspaceID, pageID string) (store.WorkspaceSnapshot, error) {
	if err := s.store.RestorePage(workspaceID, pageID); err != nil {
		return store.WorkspaceSnapshot{}, err
	}
	return s.store.Snapshot(workspaceID)
}

func (s *AppService) DeletePagePermanently(workspaceID, pageID string) (store.WorkspaceSnapshot, error) {
	if err := s.store.DeletePagePermanently(workspaceID, pageID); err != nil {
		return store.WorkspaceSnapshot{}, err
	}
	return s.store.Snapshot(workspaceID)
}

func (s *AppService) EmptyTrash(workspaceID string) (store.WorkspaceSnapshot, error) {
	if err := s.store.EmptyTrash(workspaceID); err != nil {
		return store.WorkspaceSnapshot{}, err
	}
	return s.store.Snapshot(workspaceID)
}

func (s *AppService) DuplicatePage(workspaceID, pageID string) (DuplicateResult, error) {
	newID, err := s.store.DuplicatePage(workspaceID, pageID)
	if err != nil {
		return DuplicateResult{}, err
	}
	snapshot, err := s.store.Snapshot(workspaceID)
	if err != nil {
		return DuplicateResult{}, err
	}
	return DuplicateResult{PageID: newID, Snapshot: snapshot}, nil
}

func (s *AppService) MovePage(workspaceID, pageID, newParentID, beforeID string) ([]store.PageMeta, error) {
	return s.store.MovePage(workspaceID, pageID, newParentID, beforeID)
}

func (s *AppService) SavePage(workspaceID, pageID, docJSON string, expectedRevision int64) (store.SaveResult, error) {
	return s.store.SavePage(workspaceID, pageID, docJSON, expectedRevision)
}

func (s *AppService) SaveUITabs(workspaceID string, tabs []string, active string) error {
	return s.store.SaveUITabs(workspaceID, tabs, active)
}

func (s *AppService) ToggleFavorite(workspaceID, pageID string) (bool, error) {
	return s.store.ToggleFavorite(workspaceID, pageID)
}

func (s *AppService) GetFavorites(workspaceID string) ([]string, error) {
	return s.store.GetFavorites(workspaceID)
}

func (s *AppService) GetRecent(workspaceID string) ([]store.PageMeta, error) {
	return s.store.GetRecent(workspaceID)
}

func (s *AppService) GetBacklinks(workspaceID, pageID string) ([]store.PageMeta, error) {
	return s.store.GetBacklinks(workspaceID, pageID)
}

func (s *AppService) Search(workspaceID, query string, limit int) ([]store.SearchHit, error) {
	return s.store.Search(workspaceID, query, limit)
}

func (s *AppService) GetPageTitles(workspaceID string) (map[string]string, error) {
	return s.store.PageTitles(workspaceID)
}

// SaveAsset accepts a base64 payload from BlockNote's uploadFile callback. The
// browser passes the original filename; Go validates imagery and copies it into
// the workspace before returning a stable relative URL.
func (s *AppService) SaveAsset(workspaceID, pageID, filename, base64Data string) (assets.Asset, error) {
	if _, err := s.store.PageMetaByID(workspaceID, pageID); err != nil {
		return assets.Asset{}, fmt.Errorf("cannot attach a file to a missing page")
	}
	if idx := strings.Index(base64Data, ","); idx >= 0 && strings.Contains(base64Data[:idx], "base64") {
		base64Data = base64Data[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return assets.Asset{}, fmt.Errorf("invalid attachment data")
	}
	return s.assets.Save(workspaceID, filename, data)
}

// ImportAsset opens a picker for an image/file and copies the selection into the
// active workspace. Cancelled dialogs return an empty asset with no error.
func (s *AppService) ImportAsset(workspaceID, pageID string, imagesOnly bool) (assets.Asset, error) {
	if s.app == nil {
		return assets.Asset{}, fmt.Errorf("dialogs are unavailable")
	}
	if _, err := s.store.PageMetaByID(workspaceID, pageID); err != nil {
		return assets.Asset{}, fmt.Errorf("cannot attach a file to a missing page")
	}
	d := s.app.Dialog.OpenFile().SetTitle("Attach a file")
	if imagesOnly {
		d = d.AddFilter("Images", "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.avif;*.bmp")
	} else {
		d = d.AddFilter("All files", "*")
	}
	name, err := d.PromptForSingleSelection()
	if err != nil {
		return assets.Asset{}, err
	}
	if name == "" {
		return assets.Asset{}, nil
	}
	st, err := os.Stat(name)
	if err != nil {
		return assets.Asset{}, err
	}
	if st.Size() > assets.MaxBytes {
		return assets.Asset{}, fmt.Errorf("file is larger than %d MB", assets.MaxBytes>>20)
	}
	data, err := os.ReadFile(name)
	if err != nil {
		return assets.Asset{}, err
	}
	return s.assets.Save(workspaceID, filepath.Base(name), data)
}

type ExportResult struct {
	Path string `json:"path"`
}

func (s *AppService) ExportPageJSON(workspaceID, pageID string) (ExportResult, error) {
	doc, err := s.store.LoadPageForExport(workspaceID, pageID)
	if err != nil {
		return ExportResult{}, err
	}
	path, err := s.saveDialog("Export page as JSON", doc.Title+".json", "JSON document", "*.json")
	if err != nil || path == "" {
		return ExportResult{Path: path}, err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".json") {
		path += ".json"
	}
	var raw json.RawMessage = json.RawMessage(doc.DocJSON)
	if !json.Valid(raw) {
		return ExportResult{}, fmt.Errorf("stored document is not valid JSON")
	}
	assetList, err := blocknote.AssetsFromDocument(doc.DocJSON)
	if err != nil {
		return ExportResult{}, err
	}
	payload := struct {
		Format     string          `json:"format"`
		Version    int             `json:"version"`
		ExportedAt string          `json:"exportedAt"`
		Page       store.PageMeta  `json:"page"`
		Document   json.RawMessage `json:"document"`
		Assets     []string        `json:"assets"`
	}{"noteral-page", 1, time.Now().UTC().Format(time.RFC3339), doc.PageMeta, raw, assetList}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return ExportResult{}, err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}

func (s *AppService) ExportPageMarkdown(workspaceID, pageID string) (ExportResult, error) {
	doc, err := s.store.LoadPageForExport(workspaceID, pageID)
	if err != nil {
		return ExportResult{}, err
	}
	path, err := s.saveDialog("Export page as Markdown", doc.Title+".md", "Markdown", "*.md")
	if err != nil || path == "" {
		return ExportResult{Path: path}, err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".md") {
		path += ".md"
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	folder := base + ".assets"
	assetMap := map[string]string{}
	refs, refErr := blocknote.AssetsFromDocument(doc.DocJSON)
	if refErr != nil {
		return ExportResult{}, refErr
	}
	for _, rel := range refs {
		clean := filepath.ToSlash(strings.TrimPrefix(rel, "./"))
		if clean == "" || strings.HasPrefix(clean, "../") {
			continue
		}
		dest := filepath.Join(filepath.Dir(path), folder, filepath.FromSlash(clean))
		if err := s.assets.CopyTo(workspaceID, clean, dest); err != nil {
			// Missing assets should not make the text unexportable.
			continue
		}
		assetMap[rel] = folder + "/" + clean
	}
	md, _, err := s.store.BuildMarkdown(workspaceID, pageID, func(rel string) string {
		if repl, ok := assetMap[rel]; ok {
			return repl
		}
		return rel
	})
	if err != nil {
		return ExportResult{}, err
	}
	if err := os.WriteFile(path, []byte(md), 0o644); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Path: path}, nil
}

func (s *AppService) saveDialog(title, filename, filterName, pattern string) (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("dialogs are unavailable")
	}
	d := s.app.Dialog.SaveFile()
	d.SetOptions(&application.SaveFileDialogOptions{Title: title, Filename: filename})
	return d.AddFilter(filterName, pattern).PromptForSingleSelection()
}

func (s *AppService) GetSettings() store.AppSettings { return s.store.GetAppSettings() }

func (s *AppService) SaveSettings(settings store.AppSettings) (store.AppSettings, error) {
	if err := s.store.SaveAppSettings(settings); err != nil {
		return store.AppSettings{}, err
	}
	return s.store.GetAppSettings(), nil
}

func (s *AppService) GetDataDir() string { return s.info.Root }

func (s *AppService) RevealDataDir() error {
	if s.app == nil {
		return fmt.Errorf("file manager is unavailable")
	}
	return s.app.Env.OpenFileManager(s.info.Root, false)
}

// FlushDone is called by the renderer after all dirty editors have committed.
// The window close hook waits for this before destroying the window.
func (s *AppService) FlushDone() {
	s.once.Do(func() { close(s.flush) })
}

// WaitForFlush is used by the native close hook (not the renderer).
func (s *AppService) WaitForFlush(timeout time.Duration) {
	select {
	case <-s.flush:
	case <-time.After(timeout):
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

func (s *AppService) InstallPlugin() (plugins.Info, error) {
	if s.app == nil {
		return plugins.Info{}, fmt.Errorf("dialogs are unavailable")
	}
	path, err := s.app.Dialog.OpenFile().
		SetTitle("Install a plugin bundle").
		AddFilter("Noteral plugin", "*.zip").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return plugins.Info{}, err
	}
	return s.plugins.InstallFromZip(path)
}

func (s *AppService) ListPluginCatalog() ([]plugins.CatalogEntry, error) {
	return s.plugins.Catalog()
}

func (s *AppService) InstallCatalogPlugin(id string) (plugins.Info, error) {
	info, err := s.plugins.InstallCatalog(id)
	if err != nil {
		return plugins.Info{}, err
	}
	// Enabling is explicit but examples are useful immediately.
	if strings.HasPrefix(info.Manifest.ID, "com.noteral.") {
		return s.plugins.Toggle(id, true)
	}
	return info, nil
}

func (s *AppService) FetchPluginCatalog(rawURL string) ([]plugins.CatalogEntry, error) {
	if _, err := url.ParseRequestURI(strings.TrimSpace(rawURL)); err != nil {
		return nil, fmt.Errorf("enter a valid catalog URL")
	}
	return s.plugins.FetchRemoteCatalog(rawURL)
}

func (s *AppService) GetPluginRuntime(id string) (plugins.Runtime, error) {
	return s.plugins.Runtime(id)
}
