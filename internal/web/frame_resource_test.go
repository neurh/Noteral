package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestRewriteMarkup(t *testing.T) {
	base, _ := url.Parse("https://site.test/docs/page")
	in := `<head><link rel="stylesheet" href="/a.css" crossorigin><link rel=modulepreload href="./m.js">` +
		`<script type="module" src="/app.js" integrity="sha-x" crossorigin></script>` +
		`<script src="https://cdn.test/lib.js" integrity="sha-y" crossorigin="anonymous"></script>` +
		`<img src="/i.png" crossorigin><link rel="icon" href="/f.ico">` +
		`<script type="module">import "./boot.js"; import("/lazy.js")</script></head>`
	out := string(rewriteMarkup([]byte(in), base, "wails://localhost"))
	for _, want := range []string{
		`href="wails://localhost/__browse/r/https/site.test/a.css"`,
		`href="wails://localhost/__browse/r/https/site.test/docs/m.js"`,
		`src="wails://localhost/__browse/r/https/site.test/app.js"`,
		`<script src="https://cdn.test/lib.js"></script>`,
		`<img src="/i.png">`,
		`<link rel="icon" href="/f.ico">`,
		`import "wails://localhost/__browse/r/https/site.test/docs/boot.js"`,
		`import("wails://localhost/__browse/r/https/site.test/lazy.js")`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in\n%s", want, out)
		}
	}
	if strings.Contains(out, "integrity") {
		t.Errorf("integrity should be dropped: %s", out)
	}
}

func TestRewriteModuleAndCSS(t *testing.T) {
	base, _ := url.Parse("https://site.test/assets/app.js")
	js := string(rewriteModule([]byte(`import a from"./a.js";import{b}from "/b.js";export*from'https://cdn.test/c.js';const u="/not-an-import"`), base, false, ""))
	if !strings.Contains(js, `from"./a.js"`) || !strings.Contains(js, `from "/__browse/r/https/site.test/b.js"`) || !strings.Contains(js, `from'/__browse/r/https/cdn.test/c.js'`) || !strings.Contains(js, `"/not-an-import"`) {
		t.Fatalf("module rewrite: %s", js)
	}
	css := string(rewriteCSS([]byte(`a{background:url(/bg.png)}b{background:url("img/x.png")}@font-face{src:url('https://fonts.test/f.woff2')}`), base))
	if !strings.Contains(css, `url(/__browse/r/https/site.test/bg.png)`) || !strings.Contains(css, `url("img/x.png")`) || !strings.Contains(css, `url('/__browse/r/https/fonts.test/f.woff2')`) {
		t.Fatalf("css rewrite: %s", css)
	}
}

func TestServeResource(t *testing.T) {
	site := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Access-Control-Allow-Origin", "https://site.test")
			w.Header().Set("Set-Cookie", "s=1")
			body, _ := io.ReadAll(r.Body)
			_, _ = io.WriteString(w, `{"method":"`+r.Method+`","body":"`+string(body)+`","origin":"`+r.Header.Get("Origin")+`","x":"`+r.Header.Get("X-Custom")+`","q":"`+r.URL.RawQuery+`"}`)
		case "/mod.js":
			w.Header().Set("Content-Type", "text/javascript")
			_, _ = io.WriteString(w, `import "/dep.js";`)
		}
	})
	c := testClient(t)
	host := strings.TrimPrefix(site.URL, "http://")

	r := httptest.NewRequest(http.MethodPost, ResourcePath+"http/"+host+"/api?a=1", strings.NewReader("hello"))
	r.Header.Set("Origin", "null")
	r.Header.Set("X-Custom", "yes")
	r.Header.Set("X-Noteral-Page", "https://page.test/somewhere")
	w := httptest.NewRecorder()
	c.ServeFrame(w, r)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "null" || w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("cors headers: %v", w.Header())
	}
	if w.Header().Get("Set-Cookie") != "" {
		t.Fatal("cookies must stay in the jar")
	}
	if want := `{"method":"POST","body":"hello","origin":"https://page.test","x":"yes","q":"a=1"}`; w.Body.String() != want {
		t.Fatalf("body %s", w.Body.String())
	}

	r = httptest.NewRequest(http.MethodGet, ResourcePath+"http/"+host+"/mod.js", nil)
	w = httptest.NewRecorder()
	c.ServeFrame(w, r)
	if !strings.Contains(w.Body.String(), `import "/__browse/r/http/`+host+`/dep.js"`) {
		t.Fatalf("module not rewritten: %s", w.Body.String())
	}

	r = httptest.NewRequest(http.MethodOptions, ResourcePath+"http/"+host+"/api", nil)
	r.Header.Set("Origin", "null")
	r.Header.Set("Access-Control-Request-Headers", "x-custom, content-type")
	w = httptest.NewRecorder()
	c.ServeFrame(w, r)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Headers") != "x-custom, content-type" {
		t.Fatalf("preflight: %d %v", w.Code, w.Header())
	}

	r = httptest.NewRequest(http.MethodGet, ResourcePath+"http/"+host+"/api", nil)
	r.Header.Set("Origin", "https://evil.test")
	w = httptest.NewRecorder()
	c.ServeFrame(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("real web origins must be refused, got %d", w.Code)
	}
}
