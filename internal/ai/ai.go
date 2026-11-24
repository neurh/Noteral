// Package ai stores assistant providers and chats, and proxies streaming
// completions to the configured model providers.
//
// The renderer builds provider-specific request bodies and parses the stream;
// this package only owns the parts the renderer must not: API keys, the
// network call (no CORS, no key in the webview), cancellation and storage.
// Keys never leave the Go process — views expose only a short hint.
package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Provider kinds. Every OpenAI-compatible service (OpenAI, OpenRouter, Groq,
// Mistral, DeepSeek, xAI, Together, LM Studio, Ollama, …) uses KindOpenAI with
// its own base URL.
const (
	KindOpenAI    = "openai"
	KindAnthropic = "anthropic"
	KindGemini    = "gemini"
)

const (
	maxProviders     = 32
	maxChatBytes     = 8 << 20
	maxSettingsBytes = 256 << 10
	maxErrorBody     = 64 << 10
	maxLineBytes     = 4 << 20
	anthropicVersion = "2023-06-01"
)

var (
	idRe     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,47}$`)
	chatIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{6,64}$`)
	// Gemini model ids go into the URL path.
	geminiModelRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,120}$`)
)

// Provider is the stored configuration, including the secret key.
type Provider struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Preset       string            `json:"preset"`
	BaseURL      string            `json:"baseUrl"`
	APIKey       string            `json:"apiKey,omitempty"`
	Models       []string          `json:"models"`
	DefaultModel string            `json:"defaultModel"`
	Headers      map[string]string `json:"headers,omitempty"`
	Enabled      bool              `json:"enabled"`
}

// ProviderView is what the renderer sees.
type ProviderView struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Preset       string            `json:"preset"`
	BaseURL      string            `json:"baseUrl"`
	HasKey       bool              `json:"hasKey"`
	KeyHint      string            `json:"keyHint"`
	Models       []string          `json:"models"`
	DefaultModel string            `json:"defaultModel"`
	Headers      map[string]string `json:"headers"`
	Enabled      bool              `json:"enabled"`
}

// ProviderInput updates a provider. A nil APIKey keeps the stored key; an
// empty string clears it.
type ProviderInput struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Preset       string            `json:"preset"`
	BaseURL      string            `json:"baseUrl"`
	APIKey       *string           `json:"apiKey"`
	Models       []string          `json:"models"`
	DefaultModel string            `json:"defaultModel"`
	Headers      map[string]string `json:"headers"`
	Enabled      bool              `json:"enabled"`
}

// Model is one entry of a provider's model list.
type Model struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow int    `json:"contextWindow"`
}

// ChatSummary lists a stored chat without its messages.
type ChatSummary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Mode      string `json:"mode"`
	UpdatedAt int64  `json:"updatedAt"`
	CreatedAt int64  `json:"createdAt"`
	Messages  int    `json:"messages"`
}

// Emitter delivers stream events to the renderer.
type Emitter func(name string, data any)

// Manager is safe for concurrent use.
type Manager struct {
	dir     string
	http    *http.Client
	mu      sync.Mutex
	streams map[string]context.CancelFunc
}

func New(root string) *Manager {
	return &Manager{
		dir:     filepath.Join(root, "ai"),
		http:    &http.Client{Timeout: 0},
		streams: map[string]context.CancelFunc{},
	}
}

func (m *Manager) providersPath() string { return filepath.Join(m.dir, "providers.json") }
func (m *Manager) chatsDir() string      { return filepath.Join(m.dir, "chats") }

func (m *Manager) readProviders() ([]Provider, error) {
	data, err := os.ReadFile(m.providersPath())
	if errors.Is(err, os.ErrNotExist) {
		return []Provider{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []Provider
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("providers.json is not valid JSON: %w", err)
	}
	return list, nil
}

func (m *Manager) writeProviders(list []Provider) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(m.providersPath(), data, 0o600)
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, path)
}

func view(p Provider) ProviderView {
	v := ProviderView{
		ID: p.ID, Kind: p.Kind, Name: p.Name, Preset: p.Preset, BaseURL: p.BaseURL,
		HasKey: p.APIKey != "", Models: p.Models, DefaultModel: p.DefaultModel,
		Headers: p.Headers, Enabled: p.Enabled,
	}
	if v.Models == nil {
		v.Models = []string{}
	}
	if v.Headers == nil {
		v.Headers = map[string]string{}
	}
	if k := p.APIKey; len(k) > 8 {
		v.KeyHint = "…" + k[len(k)-4:]
	} else if k != "" {
		v.KeyHint = "set"
	}
	return v
}

// ListProviders returns all providers without secrets.
func (m *Manager) ListProviders() ([]ProviderView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list, err := m.readProviders()
	if err != nil {
		return nil, err
	}
	out := make([]ProviderView, 0, len(list))
	for _, p := range list {
		out = append(out, view(p))
	}
	return out, nil
}

func validBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("base URL must be an http(s) URL")
	}
	if u.User != nil {
		return "", fmt.Errorf("put credentials in the API key field, not the URL")
	}
	return raw, nil
}

// SaveProvider creates or updates a provider.
func (m *Manager) SaveProvider(in ProviderInput) (ProviderView, error) {
	in.ID = strings.TrimSpace(in.ID)
	if !idRe.MatchString(in.ID) {
		return ProviderView{}, fmt.Errorf("provider id must be lowercase letters, digits and dashes")
	}
	switch in.Kind {
	case KindOpenAI, KindAnthropic, KindGemini:
	default:
		return ProviderView{}, fmt.Errorf("unknown provider kind %q", in.Kind)
	}
	base, err := validBaseURL(in.BaseURL)
	if err != nil {
		return ProviderView{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len(name) > 60 {
		return ProviderView{}, fmt.Errorf("provider name must be 1–60 characters")
	}
	models := []string{}
	seen := map[string]bool{}
	for _, model := range in.Models {
		model = strings.TrimSpace(model)
		if model != "" && len(model) <= 200 && !seen[model] && len(models) < 400 {
			seen[model] = true
			models = append(models, model)
		}
	}
	headers := map[string]string{}
	for k, v := range in.Headers {
		k = strings.TrimSpace(k)
		if k == "" || len(headers) >= 16 || len(k) > 100 || len(v) > 2000 {
			continue
		}
		switch strings.ToLower(k) {
		case "host", "content-length", "connection", "transfer-encoding":
			continue
		}
		headers[k] = v
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	list, err := m.readProviders()
	if err != nil {
		return ProviderView{}, err
	}
	idx := -1
	for i, p := range list {
		if p.ID == in.ID {
			idx = i
		}
	}
	p := Provider{}
	if idx >= 0 {
		p = list[idx]
	} else if len(list) >= maxProviders {
		return ProviderView{}, fmt.Errorf("too many providers")
	}
	p.ID, p.Kind, p.Name, p.Preset, p.BaseURL = in.ID, in.Kind, name, strings.TrimSpace(in.Preset), base
	p.Models, p.DefaultModel, p.Headers, p.Enabled = models, strings.TrimSpace(in.DefaultModel), headers, in.Enabled
	if in.APIKey != nil {
		p.APIKey = strings.TrimSpace(*in.APIKey)
	}
	if idx >= 0 {
		list[idx] = p
	} else {
		list = append(list, p)
	}
	if err := m.writeProviders(list); err != nil {
		return ProviderView{}, err
	}
	return view(p), nil
}

// DeleteProvider removes a provider and its key.
func (m *Manager) DeleteProvider(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	list, err := m.readProviders()
	if err != nil {
		return err
	}
	out := list[:0]
	for _, p := range list {
		if p.ID != id {
			out = append(out, p)
		}
	}
	return m.writeProviders(out)
}

func (m *Manager) provider(id string) (Provider, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list, err := m.readProviders()
	if err != nil {
		return Provider{}, err
	}
	for _, p := range list {
		if p.ID == id {
			return p, nil
		}
	}
	return Provider{}, fmt.Errorf("provider %q is not configured", id)
}

func authorize(req *http.Request, p Provider) {
	for k, v := range p.Headers {
		req.Header.Set(k, v)
	}
	switch p.Kind {
	case KindAnthropic:
		req.Header.Set("anthropic-version", anthropicVersion)
		if p.APIKey != "" {
			req.Header.Set("x-api-key", p.APIKey)
		}
	case KindGemini:
		if p.APIKey != "" {
			req.Header.Set("x-goog-api-key", p.APIKey)
		}
	default:
		if p.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+p.APIKey)
		}
	}
	if p.Preset == "openrouter" {
		req.Header.Set("HTTP-Referer", "https://github.com/neurh/Noteral")
		req.Header.Set("X-Title", "Noteral")
	}
}

func endpoint(p Provider, model string) (string, error) {
	switch p.Kind {
	case KindAnthropic:
		return p.BaseURL + "/v1/messages", nil
	case KindGemini:
		model = strings.TrimPrefix(model, "models/")
		if !geminiModelRe.MatchString(model) {
			return "", fmt.Errorf("invalid Gemini model %q", model)
		}
		return p.BaseURL + "/v1beta/models/" + url.PathEscape(model) + ":streamGenerateContent?alt=sse", nil
	default:
		return p.BaseURL + "/chat/completions", nil
	}
}

// providerError turns an error response into one readable sentence.
func providerError(status int, body []byte) error {
	var parsed struct {
		Error any `json:"error"`
	}
	msg := ""
	if json.Unmarshal(body, &parsed) == nil && parsed.Error != nil {
		switch e := parsed.Error.(type) {
		case string:
			msg = e
		case map[string]any:
			if s, ok := e["message"].(string); ok {
				msg = s
			}
		}
	}
	if msg == "" {
		var arr []struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(body, &arr) == nil && len(arr) > 0 {
			msg = arr[0].Error.Message
		}
	}
	if msg == "" {
		msg = strings.TrimSpace(string(body))
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
	}
	hint := ""
	switch status {
	case 401, 403:
		hint = " — check the API key"
	case 404:
		hint = " — check the model name and base URL"
	case 429:
		hint = " — rate limited, try again shortly"
	}
	if msg == "" {
		msg = http.StatusText(status)
	}
	return fmt.Errorf("provider returned %d: %s%s", status, msg, hint)
}

// StreamEvent is emitted as "ai:stream". Lines holds raw SSE data payloads
// (or NDJSON lines) in arrival order.
type StreamEvent struct {
	ID    string   `json:"id"`
	Lines []string `json:"lines"`
}

// DoneEvent is emitted as "ai:done" once per stream.
type DoneEvent struct {
	ID        string `json:"id"`
	Error     string `json:"error"`
	Cancelled bool   `json:"cancelled"`
	Status    int    `json:"status"`
}

// Stream starts a completion in the background. The body is the provider
// request JSON built by the renderer; Stream forces streaming on.
func (m *Manager) Stream(requestID, providerID, model, body string, emit Emitter) error {
	if !chatIDRe.MatchString(requestID) {
		return fmt.Errorf("invalid request id")
	}
	p, err := m.provider(providerID)
	if err != nil {
		return err
	}
	if !p.Enabled {
		return fmt.Errorf("provider %s is turned off", p.Name)
	}
	target, err := endpoint(p, model)
	if err != nil {
		return err
	}
	if len(body) > 32<<20 {
		return fmt.Errorf("conversation is too large to send")
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(body), &probe); err != nil {
		return fmt.Errorf("request body is not valid JSON")
	}
	if p.Kind != KindGemini {
		probe["stream"] = true
		if p.Kind == KindOpenAI {
			if _, ok := probe["stream_options"]; !ok && p.Preset != "ollama" {
				probe["stream_options"] = map[string]any{"include_usage": true}
			}
		}
		data, _ := json.Marshal(probe)
		body = string(data)
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	if old, ok := m.streams[requestID]; ok {
		old()
	}
	m.streams[requestID] = cancel
	m.mu.Unlock()

	go m.run(ctx, cancel, requestID, p, target, body, emit)
	return nil
}

func (m *Manager) run(ctx context.Context, cancel context.CancelFunc, id string, p Provider, target, body string, emit Emitter) {
	done := DoneEvent{ID: id}
	defer func() {
		// Read ctx before our own cancel(): only an outside Cancel counts as cancelled.
		if ctx.Err() != nil && done.Error == "" {
			done.Cancelled = true
		}
		cancel()
		m.mu.Lock()
		delete(m.streams, id)
		m.mu.Unlock()
		emit("ai:done", done)
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(body))
	if err != nil {
		done.Error = err.Error()
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	authorize(req, p)
	resp, err := m.http.Do(req)
	if err != nil {
		if ctx.Err() == nil {
			done.Error = friendlyNetError(err, p)
		}
		return
	}
	defer resp.Body.Close()
	done.Status = resp.StatusCode
	if resp.StatusCode >= 400 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))
		done.Error = providerError(resp.StatusCode, data).Error()
		return
	}

	// Batch lines so a fast model doesn't flood the IPC bridge.
	var (
		batchMu sync.Mutex
		batch   []string
	)
	flush := func() {
		batchMu.Lock()
		lines := batch
		batch = nil
		batchMu.Unlock()
		if len(lines) > 0 {
			emit("ai:stream", StreamEvent{ID: id, Lines: lines})
		}
	}
	ticker := time.NewTicker(40 * time.Millisecond)
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-ticker.C:
				flush()
			case <-stop:
				return
			}
		}
	}()
	defer func() {
		ticker.Stop()
		close(stop)
		flush()
	}()

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64<<10), maxLineBytes)
	isSSE := strings.Contains(resp.Header.Get("Content-Type"), "event-stream")
	var data bytes.Buffer
	push := func(s string) {
		batchMu.Lock()
		batch = append(batch, s)
		batchMu.Unlock()
	}
	for sc.Scan() {
		line := sc.Text()
		if !isSSE {
			if strings.TrimSpace(line) != "" {
				push(line)
			}
			continue
		}
		switch {
		case line == "":
			if data.Len() > 0 {
				push(data.String())
				data.Reset()
			}
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if data.Len() > 0 {
		push(data.String())
	}
	if err := sc.Err(); err != nil && ctx.Err() == nil {
		done.Error = "stream interrupted: " + err.Error()
	}
}

func friendlyNetError(err error, p Provider) string {
	msg := err.Error()
	if strings.Contains(msg, "connection refused") {
		return fmt.Sprintf("could not connect to %s at %s — is it running?", p.Name, p.BaseURL)
	}
	if strings.Contains(msg, "no such host") {
		return fmt.Sprintf("could not resolve %s — check the base URL and your connection", p.BaseURL)
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		return "network error: " + ue.Err.Error()
	}
	return "network error: " + msg
}

// Cancel stops a running stream.
func (m *Manager) Cancel(requestID string) {
	m.mu.Lock()
	cancel, ok := m.streams[requestID]
	m.mu.Unlock()
	if ok {
		cancel()
	}
}

// ListModels asks the provider for its models.
func (m *Manager) ListModels(providerID string) ([]Model, error) {
	p, err := m.provider(providerID)
	if err != nil {
		return nil, err
	}
	var target string
	switch p.Kind {
	case KindAnthropic:
		target = p.BaseURL + "/v1/models?limit=100"
	case KindGemini:
		target = p.BaseURL + "/v1beta/models?pageSize=200"
	default:
		target = p.BaseURL + "/models"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	authorize(req, p)
	resp, err := m.http.Do(req)
	if err != nil {
		return nil, errors.New(friendlyNetError(err, p))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, providerError(resp.StatusCode, data)
	}
	return parseModels(p.Kind, data)
}

func parseModels(kind string, data []byte) ([]Model, error) {
	var out []Model
	switch kind {
	case KindGemini:
		var r struct {
			Models []struct {
				Name             string   `json:"name"`
				DisplayName      string   `json:"displayName"`
				InputTokenLimit  int      `json:"inputTokenLimit"`
				SupportedMethods []string `json:"supportedGenerationMethods"`
			} `json:"models"`
		}
		if err := json.Unmarshal(data, &r); err != nil {
			return nil, fmt.Errorf("unexpected models response")
		}
		for _, mm := range r.Models {
			ok := len(mm.SupportedMethods) == 0
			for _, s := range mm.SupportedMethods {
				if s == "generateContent" || s == "streamGenerateContent" {
					ok = true
				}
			}
			if ok {
				out = append(out, Model{ID: strings.TrimPrefix(mm.Name, "models/"), Name: mm.DisplayName, ContextWindow: mm.InputTokenLimit})
			}
		}
	default:
		var r struct {
			Data []struct {
				ID            string `json:"id"`
				Name          string `json:"name"`
				DisplayName   string `json:"display_name"`
				ContextLength int    `json:"context_length"`
				MaxInput      int    `json:"max_input_tokens"`
			} `json:"data"`
			Models []struct {
				Name  string `json:"name"`
				Model string `json:"model"`
			} `json:"models"`
		}
		if err := json.Unmarshal(data, &r); err != nil {
			return nil, fmt.Errorf("unexpected models response")
		}
		for _, mm := range r.Data {
			name := mm.DisplayName
			if name == "" {
				name = mm.Name
			}
			ctxw := mm.ContextLength
			if ctxw == 0 {
				ctxw = mm.MaxInput
			}
			out = append(out, Model{ID: mm.ID, Name: name, ContextWindow: ctxw})
		}
		for _, mm := range r.Models { // Ollama /api/tags shape
			id := mm.Model
			if id == "" {
				id = mm.Name
			}
			out = append(out, Model{ID: id, Name: mm.Name})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if out == nil {
		out = []Model{}
	}
	return out, nil
}

// --- settings -----------------------------------------------------------------

// GetSettings returns the renderer-owned assistant settings document.
func (m *Manager) GetSettings() (string, error) {
	data, err := os.ReadFile(filepath.Join(m.dir, "settings.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "{}", nil
	}
	return string(data), err
}

func (m *Manager) SaveSettings(doc string) error {
	if len(doc) > maxSettingsBytes || !json.Valid([]byte(doc)) {
		return fmt.Errorf("assistant settings must be valid JSON under 256 KB")
	}
	return writeAtomic(filepath.Join(m.dir, "settings.json"), []byte(doc), 0o600)
}

// --- chats --------------------------------------------------------------------

type chatHeader struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Mode      string            `json:"mode"`
	CreatedAt int64             `json:"createdAt"`
	UpdatedAt int64             `json:"updatedAt"`
	Messages  []json.RawMessage `json:"messages"`
}

// ListChats returns stored chats, newest first.
func (m *Manager) ListChats() ([]ChatSummary, error) {
	entries, err := os.ReadDir(m.chatsDir())
	if errors.Is(err, os.ErrNotExist) {
		return []ChatSummary{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []ChatSummary{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(m.chatsDir(), e.Name()))
		if err != nil {
			continue
		}
		var h chatHeader
		if json.Unmarshal(data, &h) != nil || !chatIDRe.MatchString(h.ID) {
			continue
		}
		out = append(out, ChatSummary{ID: h.ID, Title: h.Title, Mode: h.Mode, CreatedAt: h.CreatedAt, UpdatedAt: h.UpdatedAt, Messages: len(h.Messages)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out, nil
}

// GetChat returns a stored chat document.
func (m *Manager) GetChat(id string) (string, error) {
	if !chatIDRe.MatchString(id) {
		return "", fmt.Errorf("invalid chat id")
	}
	data, err := os.ReadFile(filepath.Join(m.chatsDir(), id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("chat not found")
	}
	return string(data), err
}

// SaveChat stores a chat document ({id,title,mode,createdAt,updatedAt,messages}).
func (m *Manager) SaveChat(doc string) error {
	if len(doc) > maxChatBytes {
		return fmt.Errorf("chat is too large to save (over 8 MB)")
	}
	var h chatHeader
	if err := json.Unmarshal([]byte(doc), &h); err != nil {
		return fmt.Errorf("chat is not valid JSON")
	}
	if !chatIDRe.MatchString(h.ID) {
		return fmt.Errorf("invalid chat id")
	}
	return writeAtomic(filepath.Join(m.chatsDir(), h.ID+".json"), []byte(doc), 0o600)
}

func (m *Manager) DeleteChat(id string) error {
	if !chatIDRe.MatchString(id) {
		return fmt.Errorf("invalid chat id")
	}
	err := os.Remove(filepath.Join(m.chatsDir(), id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
