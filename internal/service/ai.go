package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"time"

	"noteral/internal/ai"
	"noteral/internal/web"
)

const maxCustomizationBytes = 4 << 20

func (s *AppService) emit(name string, data any) {
	if s.app != nil {
		s.app.Event.Emit(name, data)
	}
}

// --- assistant providers ------------------------------------------------------

func (s *AppService) ListAIProviders() ([]ai.ProviderView, error) { return s.ai.ListProviders() }

func (s *AppService) SaveAIProvider(in ai.ProviderInput) (ai.ProviderView, error) {
	return s.ai.SaveProvider(in)
}

func (s *AppService) DeleteAIProvider(id string) error { return s.ai.DeleteProvider(id) }

func (s *AppService) ListAIModels(providerID string) ([]ai.Model, error) {
	return s.ai.ListModels(providerID)
}

// StartAIStream begins a streaming completion. Chunks arrive as "ai:stream"
// events and completion as one "ai:done" event, both keyed by requestID.
func (s *AppService) StartAIStream(requestID, providerID, model, body string) error {
	return s.ai.Stream(requestID, providerID, model, body, s.emit)
}

func (s *AppService) CancelAIStream(requestID string) { s.ai.Cancel(requestID) }

func (s *AppService) GetAISettings() (string, error)         { return s.ai.GetSettings() }
func (s *AppService) SaveAISettings(doc string) error        { return s.ai.SaveSettings(doc) }
func (s *AppService) ListAIChats() ([]ai.ChatSummary, error) { return s.ai.ListChats() }
func (s *AppService) GetAIChat(id string) (string, error)    { return s.ai.GetChat(id) }
func (s *AppService) SaveAIChat(doc string) error            { return s.ai.SaveChat(doc) }
func (s *AppService) DeleteAIChat(id string) error           { return s.ai.DeleteChat(id) }

// --- free web tools -------------------------------------------------------------

// WebSearch runs a keyless web search (DuckDuckGo, falling back to Wikipedia).
func (s *AppService) WebSearch(query string, limit int) (web.SearchResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	return s.web.Search(ctx, query, limit)
}

// WebFetch downloads a page and returns readable Markdown.
func (s *AppService) WebFetch(rawURL string, maxChars int) (web.Page, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.web.Fetch(ctx, rawURL, maxChars)
}

// BrowserFrame serves web.FramePath, the pages shown in the in-app browser.
// A package function rather than a method so it stays out of the bindings.
func BrowserFrame(s *AppService) http.Handler {
	return http.HandlerFunc(s.web.ServeFrame)
}

// BrowserLoad fetches a page for the in-app browser: its readable Markdown,
// and whether the site allows being shown in a frame.
func (s *AppService) BrowserLoad(rawURL string) (web.BrowsePage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.web.Browse(ctx, rawURL)
}

// GetBrowserState returns the workspace's saved browser tabs, bookmarks and
// history as a JSON object.
func (s *AppService) GetBrowserState(workspaceID string) (string, error) {
	return s.store.GetBrowserState(workspaceID)
}

// SaveBrowserState stores the workspace's browser tabs, bookmarks and history.
func (s *AppService) SaveBrowserState(workspaceID, doc string) error {
	return s.store.SaveBrowserState(workspaceID, doc)
}

// PluginHTTP performs an HTTP request on behalf of a plugin that holds the
// "network" permission. The permission is re-checked here, not only in the UI.
func (s *AppService) PluginHTTP(pluginID string, req web.Request) (web.Response, error) {
	rt, err := s.plugins.Runtime(pluginID)
	if err != nil {
		return web.Response{}, err
	}
	local := slices.Contains(rt.Manifest.Permissions, "network.local")
	if !local && !slices.Contains(rt.Manifest.Permissions, "network") {
		return web.Response{}, fmt.Errorf("plugin %s does not have the network permission", pluginID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	if local {
		s.localWebOnce.Do(func() {
			s.localWeb = web.New()
			s.localWeb.SetAllowPrivate(true)
		})
		return s.localWeb.Do(ctx, req)
	}
	return s.web.Do(ctx, req)
}

// --- customizations -----------------------------------------------------------

func (s *AppService) customizationsPath() string {
	return filepath.Join(s.info.Root, "customizations.json")
}

// GetCustomizations returns the appearance/layout customization document
// (theme tokens, CSS snippets, layout and component options). "{}" when unset.
func (s *AppService) GetCustomizations() (string, error) {
	data, err := os.ReadFile(s.customizationsPath())
	if errors.Is(err, os.ErrNotExist) {
		return "{}", nil
	}
	return string(data), err
}

// SaveCustomizations replaces the customization document.
func (s *AppService) SaveCustomizations(doc string) error {
	if len(doc) > maxCustomizationBytes {
		return fmt.Errorf("customizations are larger than 4 MB")
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(doc), &probe); err != nil {
		return fmt.Errorf("customizations must be a JSON object")
	}
	path := s.customizationsPath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(doc), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
