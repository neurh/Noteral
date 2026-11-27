package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func frameRequest(t *testing.T, c *Client, target string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, FramePath+"?url="+url.QueryEscape(target), nil)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	c.ServeFrame(w, r)
	return w
}

func TestServeFrame(t *testing.T) {
	site := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/page":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
			_, _ = io.WriteString(w, `<html><head><title>Hi</title></head><body><a href="/next">next</a></body></html>`)
		case "/bare":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, `<p>no head</p>`)
		case "/image.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte{0x89, 'P', 'N', 'G'})
		case "/gone":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `<html><head></head><body>missing</body></html>`)
		}
	})
	c := testClient(t)

	w := frameRequest(t, c, site.URL+"/page", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `<base href="`+site.URL+`/page">`) || !strings.Contains(body, "window.__noteralFrame=") {
		t.Fatalf("bridge not injected: %s", body[:min(300, len(body))])
	}
	if strings.Index(body, "window.__noteralFrame") > strings.Index(body, "<title>") {
		t.Fatal("bridge must run before the page's own head")
	}
	if w.Header().Get("X-Frame-Options") != "" {
		t.Fatal("frame-blocking header leaked through")
	}
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.HasPrefix(csp, "sandbox ") || strings.Contains(csp, "allow-same-origin") || !strings.Contains(csp, "frame-ancestors 'self'") {
		t.Fatalf("csp = %q", csp)
	}

	if body := frameRequest(t, c, site.URL+"/bare", nil).Body.String(); !strings.Contains(body, "<head><meta charset") {
		t.Fatalf("bare page: %s", body)
	}
	if w := frameRequest(t, c, site.URL+"/image.png", nil); w.Code != http.StatusFound || w.Header().Get("Location") != site.URL+"/image.png" {
		t.Fatalf("image: %d %q", w.Code, w.Header().Get("Location"))
	}
	if w := frameRequest(t, c, site.URL+"/gone", nil); w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), `"status":404`) {
		t.Fatalf("404 page: %d", w.Code)
	}
	if w := frameRequest(t, c, site.URL+"/page", map[string]string{"Sec-Fetch-Site": "cross-site"}); w.Code != http.StatusForbidden {
		t.Fatalf("cross-site load allowed: %d", w.Code)
	}
	if w := frameRequest(t, c, "file:///etc/passwd", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("file url: %d", w.Code)
	}
	r := httptest.NewRequest(http.MethodPost, FramePath+"?url="+url.QueryEscape(site.URL+"/page"), nil)
	pw := httptest.NewRecorder()
	c.ServeFrame(pw, r)
	if pw.Code != http.StatusMethodNotAllowed {
		t.Fatalf("post: %d", pw.Code)
	}
}

func TestServeFrameBlocksPrivate(t *testing.T) {
	site := serve(t, func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "secret") })
	w := frameRequest(t, New(), site.URL, nil)
	if w.Code != http.StatusBadGateway || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("private address reachable: %d", w.Code)
	}
}
