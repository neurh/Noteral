package web

import (
	"context"
	"net/http"
	"testing"
)

func TestFrameable(t *testing.T) {
	cases := []struct {
		name   string
		header map[string]string
		want   bool
	}{
		{"no headers", nil, true},
		{"xfo deny", map[string]string{"X-Frame-Options": "DENY"}, false},
		{"xfo sameorigin", map[string]string{"X-Frame-Options": "sameorigin"}, false},
		{"xfo allow-from is ignored", map[string]string{"X-Frame-Options": "ALLOW-FROM https://a.example"}, true},
		{"csp none", map[string]string{"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'"}, false},
		{"csp self", map[string]string{"Content-Security-Policy": "frame-ancestors 'self' https://a.example"}, false},
		{"csp star", map[string]string{"Content-Security-Policy": "frame-ancestors *", "X-Frame-Options": "DENY"}, true},
		{"csp without frame-ancestors", map[string]string{"Content-Security-Policy": "script-src 'self'"}, true},
	}
	for _, tc := range cases {
		h := http.Header{}
		for k, v := range tc.header {
			h.Set(k, v)
		}
		got, reason := frameable(h)
		if got != tc.want {
			t.Errorf("%s: frameable = %v (%q), want %v", tc.name, got, reason, tc.want)
		}
		if !got && reason == "" {
			t.Errorf("%s: missing reason", tc.name)
		}
	}
}

func TestBrowse(t *testing.T) {
	s := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/article":
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><title>Hello page</title></head><body><article><h1>Hello</h1><p>` +
				`Some readable text that is long enough to count as the article body of this page.</p></article></body></html>`))
		case "/image":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\n0000"))
		case "/missing":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`<html><head><title>Not here</title></head><body><p>Nothing at this address.</p></body></html>`))
		}
	})
	c := testClient(t)
	ctx := context.Background()

	page, err := c.Browse(ctx, s.URL+"/article")
	if err != nil {
		t.Fatal(err)
	}
	if page.Embeddable || page.FrameReason == "" || !page.Readable || page.Title != "Hello page" {
		t.Fatalf("article: %+v", page)
	}

	page, err = c.Browse(ctx, s.URL+"/image")
	if err != nil {
		t.Fatalf("image should load softly: %v", err)
	}
	if !page.Embeddable || page.Readable || page.ContentType != "image/png" || page.Error == "" {
		t.Fatalf("image: %+v", page)
	}

	page, err = c.Browse(ctx, s.URL+"/missing")
	if err != nil {
		t.Fatalf("404 should load softly: %v", err)
	}
	if page.Status != 404 || page.Error == "" || page.Title != "Not here" {
		t.Fatalf("missing: %+v", page)
	}

	if _, err := c.Browse(ctx, "ftp://example.com"); err == nil {
		t.Fatal("non-http URL should fail")
	}
}
