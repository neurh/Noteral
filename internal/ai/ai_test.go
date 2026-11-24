package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu    sync.Mutex
	lines []string
	done  chan DoneEvent
}

func newRecorder() *recorder { return &recorder{done: make(chan DoneEvent, 1)} }

func (r *recorder) emit(name string, data any) {
	switch ev := data.(type) {
	case StreamEvent:
		r.mu.Lock()
		r.lines = append(r.lines, ev.Lines...)
		r.mu.Unlock()
	case DoneEvent:
		r.done <- ev
	}
}

func (r *recorder) wait(t *testing.T) DoneEvent {
	t.Helper()
	select {
	case ev := <-r.done:
		return ev
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not finish")
	}
	return DoneEvent{}
}

func key(s string) *string { return &s }

func TestProvidersHideKeys(t *testing.T) {
	m := New(t.TempDir())
	v, err := m.SaveProvider(ProviderInput{ID: "openai", Kind: KindOpenAI, Name: "OpenAI", BaseURL: "https://api.openai.com/v1/", APIKey: key("sk-test-1234567890"), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !v.HasKey || v.KeyHint != "…7890" || v.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("unexpected view %+v", v)
	}
	// nil key keeps the stored one
	if _, err := m.SaveProvider(ProviderInput{ID: "openai", Kind: KindOpenAI, Name: "OpenAI 2", BaseURL: "https://api.openai.com/v1", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	p, _ := m.provider("openai")
	if p.APIKey != "sk-test-1234567890" || p.Name != "OpenAI 2" {
		t.Fatalf("key not preserved: %+v", p)
	}
	list, _ := m.ListProviders()
	raw, _ := json.Marshal(list)
	if strings.Contains(string(raw), "sk-test") {
		t.Fatal("key leaked in list")
	}
	if _, err := m.SaveProvider(ProviderInput{ID: "Bad ID", Kind: KindOpenAI, Name: "x", BaseURL: "https://x"}); err == nil {
		t.Fatal("expected id error")
	}
	if _, err := m.SaveProvider(ProviderInput{ID: "x", Kind: KindOpenAI, Name: "x", BaseURL: "ftp://x"}); err == nil {
		t.Fatal("expected url error")
	}
}

func TestStreamOpenAI(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		if r.URL.Path != "/v1/chat/completions" {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"a\":1}\n\n: keepalive\n\ndata: {\"b\":\ndata: 2}\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()
	m := New(t.TempDir())
	_, err := m.SaveProvider(ProviderInput{ID: "local", Kind: KindOpenAI, Name: "Local", BaseURL: srv.URL + "/v1", APIKey: key("abc"), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	rec := newRecorder()
	if err := m.Stream("req-0001", "local", "m", `{"model":"m","messages":[]}`, rec.emit); err != nil {
		t.Fatal(err)
	}
	done := rec.wait(t)
	if done.Error != "" {
		t.Fatal(done.Error)
	}
	if done.Cancelled {
		t.Fatal("a stream that finished normally was reported as cancelled")
	}
	if gotAuth != "Bearer abc" {
		t.Fatalf("auth %q", gotAuth)
	}
	if !strings.Contains(gotBody, `"stream":true`) || !strings.Contains(gotBody, `"include_usage":true`) {
		t.Fatalf("body %s", gotBody)
	}
	want := []string{`{"a":1}`, "{\"b\":\n2}", "[DONE]"}
	if strings.Join(rec.lines, "|") != strings.Join(want, "|") {
		t.Fatalf("lines %q", rec.lines)
	}
}

func TestStreamAnthropicErrorAndHeaders(t *testing.T) {
	var version, apiKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		version = r.Header.Get("anthropic-version")
		apiKey = r.Header.Get("x-api-key")
		w.WriteHeader(401)
		fmt.Fprint(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	defer srv.Close()
	m := New(t.TempDir())
	m.SaveProvider(ProviderInput{ID: "claude", Kind: KindAnthropic, Name: "Anthropic", BaseURL: srv.URL, APIKey: key("k1"), Enabled: true})
	rec := newRecorder()
	if err := m.Stream("req-0002", "claude", "claude-opus-5-5", `{}`, rec.emit); err != nil {
		t.Fatal(err)
	}
	done := rec.wait(t)
	if version != anthropicVersion || apiKey != "k1" {
		t.Fatalf("headers %q %q", version, apiKey)
	}
	if done.Status != 401 || !strings.Contains(done.Error, "invalid x-api-key") || !strings.Contains(done.Error, "check the API key") {
		t.Fatalf("done %+v", done)
	}
}

func TestStreamCancel(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)
	m := New(t.TempDir())
	m.SaveProvider(ProviderInput{ID: "g", Kind: KindGemini, Name: "Gemini", BaseURL: srv.URL, Enabled: true})
	rec := newRecorder()
	if err := m.Stream("req-0003", "g", "gemini-2.5-flash", `{}`, rec.emit); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	m.Cancel("req-0003")
	done := rec.wait(t)
	if !done.Cancelled {
		t.Fatalf("expected cancelled: %+v", done)
	}
	if err := m.Stream("req-0004", "g", "bad/model?x", `{}`, rec.emit); err == nil {
		t.Fatal("expected invalid model")
	}
}

func TestParseModels(t *testing.T) {
	got, err := parseModels(KindOpenAI, []byte(`{"data":[{"id":"b","context_length":10},{"id":"a","display_name":"A"}]}`))
	if err != nil || len(got) != 2 || got[0].ID != "a" || got[0].Name != "A" || got[1].ContextWindow != 10 {
		t.Fatalf("%v %+v", err, got)
	}
	got, _ = parseModels(KindGemini, []byte(`{"models":[{"name":"models/gemini-x","displayName":"X","supportedGenerationMethods":["generateContent"]},{"name":"models/embed","supportedGenerationMethods":["embedContent"]}]}`))
	if len(got) != 1 || got[0].ID != "gemini-x" {
		t.Fatalf("%+v", got)
	}
}

func TestChats(t *testing.T) {
	m := New(t.TempDir())
	doc := `{"id":"chat_abc123","title":"Hello","mode":"ask","createdAt":1,"updatedAt":5,"messages":[{"role":"user"}]}`
	if err := m.SaveChat(doc); err != nil {
		t.Fatal(err)
	}
	m.SaveChat(`{"id":"chat_def456","title":"Two","mode":"edit","createdAt":1,"updatedAt":9,"messages":[]}`)
	list, err := m.ListChats()
	if err != nil || len(list) != 2 || list[0].ID != "chat_def456" || list[1].Messages != 1 {
		t.Fatalf("%v %+v", err, list)
	}
	got, err := m.GetChat("chat_abc123")
	if err != nil || got != doc {
		t.Fatalf("%v %q", err, got)
	}
	if err := m.SaveChat(`{"id":"../evil"}`); err == nil {
		t.Fatal("expected invalid id")
	}
	if err := m.DeleteChat("chat_abc123"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.GetChat("chat_abc123"); err == nil {
		t.Fatal("expected not found")
	}
}
