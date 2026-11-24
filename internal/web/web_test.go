package web

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
)

func testClient(t *testing.T) *Client {
	t.Helper()
	c := New()
	c.SetAllowPrivate(true)
	return c
}

func serve(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return s
}

const ddgHTMLFixture = `<!DOCTYPE html><html><body>
<div class="results">
  <div class="result results_links results_links_deep result--ad">
    <h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x&u3=https%3A%2F%2Fads.example">Buy Generics Now</a></h2>
    <a class="result__snippet" href="#">Sponsored stuff</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgo.dev%2Fdoc%2Ftutorial%2Fgenerics%3Fx%3D1%26y%3D2&amp;rut=abc">Tutorial: Getting started with <b>generics</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">This tutorial introduces the basics of <b>generics</b> in Go.</a>
  </div>
  <div class="result results_links web-result">
    <h2 class="result__title"><a class="result__a" href="https://www.example.org/generics">Direct link result</a></h2>
    <div class="result__snippet">Plain   snippet
      text.</div>
  </div>
  <div class="result results_links web-result">
    <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgo.dev%2Fdoc%2Ftutorial%2Fgenerics%3Fx%3D1%26y%3D2">Duplicate</a></h2>
  </div>
</div>
</body></html>`

func TestSearchDDGHTML(t *testing.T) {
	var gotQuery, gotUA string
	ddg := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		_ = r.ParseForm()
		gotQuery = r.PostForm.Get("q")
		gotUA = r.UserAgent()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, ddgHTMLFixture)
	})
	c := testClient(t)
	c.ddgHTMLURL = ddg.URL
	c.ddgLiteURL = "http://127.0.0.1:1/unused"
	c.wikiAPIURL = "http://127.0.0.1:1/unused"

	resp, err := c.Search(context.Background(), "  golang   generics ", 0)
	if err != nil {
		t.Fatal(err)
	}
	if gotQuery != "golang generics" || resp.Query != "golang generics" {
		t.Errorf("query sent %q, response %q", gotQuery, resp.Query)
	}
	if !strings.Contains(gotUA, "Mozilla/5.0") {
		t.Errorf("user agent %q is not a browser UA", gotUA)
	}
	if resp.Engine != "duckduckgo" {
		t.Errorf("engine = %q", resp.Engine)
	}
	want := []SearchResult{
		{
			Title:   "Tutorial: Getting started with generics",
			URL:     "https://go.dev/doc/tutorial/generics?x=1&y=2",
			Snippet: "This tutorial introduces the basics of generics in Go.",
			Source:  "go.dev",
		},
		{
			Title:   "Direct link result",
			URL:     "https://www.example.org/generics",
			Snippet: "Plain snippet text.",
			Source:  "www.example.org",
		},
	}
	if len(resp.Results) != len(want) {
		t.Fatalf("got %d results: %+v", len(resp.Results), resp.Results)
	}
	for i := range want {
		if resp.Results[i] != want[i] {
			t.Errorf("result %d:\n got %+v\nwant %+v", i, resp.Results[i], want[i])
		}
	}

	resp, err = c.Search(context.Background(), "golang generics", 1)
	if err != nil || len(resp.Results) != 1 {
		t.Errorf("limit 1: %d results, err %v", len(resp.Results), err)
	}
}

func TestSearchFallsBackToLiteThenWikipedia(t *testing.T) {
	ddg := serve(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `<html><body><div class="results"><div class="result result--no-result">No results.</div></div></body></html>`)
	})
	lite := serve(t, func(w http.ResponseWriter, r *http.Request) {
		// A bot challenge page.
		w.WriteHeader(http.StatusAccepted)
		io.WriteString(w, `<html><body><form id="challenge-form"><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div></form></body></html>`)
	})
	var gotParams url.Values
	wiki := serve(t, func(w http.ResponseWriter, r *http.Request) {
		gotParams = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"query":{"search":[
			{"title":"Generic programming","snippet":"<span class=\"searchmatch\">Generic</span> programming is a style &amp; method"},
			{"title":"Go (programming language)","snippet":"<span class=\"searchmatch\">Go</span> is a language"},
			{"title":"AC/DC","snippet":"band"}]}}`)
	})
	c := testClient(t)
	c.ddgHTMLURL, c.ddgLiteURL, c.wikiAPIURL = ddg.URL, lite.URL, wiki.URL

	resp, err := c.Search(context.Background(), "golang generics", 2)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Engine != "wikipedia" {
		t.Fatalf("engine = %q, want wikipedia", resp.Engine)
	}
	if gotParams.Get("srsearch") != "golang generics" || gotParams.Get("srlimit") != "2" ||
		gotParams.Get("action") != "query" || gotParams.Get("list") != "search" || gotParams.Get("format") != "json" {
		t.Errorf("wikipedia params = %v", gotParams)
	}
	want := []SearchResult{
		{Title: "Generic programming", URL: "https://en.wikipedia.org/wiki/Generic_programming",
			Snippet: "Generic programming is a style & method", Source: "en.wikipedia.org"},
		{Title: "Go (programming language)", URL: "https://en.wikipedia.org/wiki/Go_(programming_language)",
			Snippet: "Go is a language", Source: "en.wikipedia.org"},
	}
	if len(resp.Results) != 2 {
		t.Fatalf("results = %+v", resp.Results)
	}
	for i := range want {
		if resp.Results[i] != want[i] {
			t.Errorf("result %d:\n got %+v\nwant %+v", i, resp.Results[i], want[i])
		}
	}
}

func TestSearchDDGLite(t *testing.T) {
	ddg := serve(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	})
	lite := serve(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `<html><body><table>
<tr class="result-sponsored"><td><a class="result-link" href="https://duckduckgo.com/y.js?ad=1">Ad</a></td></tr>
<tr><td>1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgo.dev%2Fblog%2Fintro-generics" class="result-link">An Introduction To Generics</a></td></tr>
<tr><td></td><td class="result-snippet">The Go 1.18 release adds support for generics.</td></tr>
<tr><td></td><td><span class="link-text">go.dev/blog/intro-generics</span></td></tr>
<tr><td>2.&nbsp;</td><td><a href="https://example.com/x" class="result-link">Second</a></td></tr>
</table></body></html>`)
	})
	c := testClient(t)
	c.ddgHTMLURL, c.ddgLiteURL = ddg.URL, lite.URL
	c.wikiAPIURL = "http://127.0.0.1:1/unused"
	resp, err := c.Search(context.Background(), "generics", 5)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Engine != "duckduckgo-lite" || len(resp.Results) != 2 {
		t.Fatalf("engine %q results %+v", resp.Engine, resp.Results)
	}
	r0 := resp.Results[0]
	if r0.URL != "https://go.dev/blog/intro-generics" || r0.Title != "An Introduction To Generics" ||
		r0.Snippet != "The Go 1.18 release adds support for generics." || r0.Source != "go.dev" {
		t.Errorf("result 0 = %+v", r0)
	}
	if resp.Results[1].Snippet != "" {
		t.Errorf("result 1 snippet = %q", resp.Results[1].Snippet)
	}
}

func TestSearchAllEnginesFail(t *testing.T) {
	bad := serve(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	})
	c := testClient(t)
	c.ddgHTMLURL, c.ddgLiteURL, c.wikiAPIURL = bad.URL, bad.URL, bad.URL
	_, err := c.Search(context.Background(), "x", 3)
	if err == nil || !strings.Contains(err.Error(), "search failed") || !strings.Contains(err.Error(), "HTTP 503") {
		t.Fatalf("err = %v", err)
	}
	if _, err := c.Search(context.Background(), "   ", 3); err == nil {
		t.Error("empty query should fail")
	}
}

const articleFixture = `<!DOCTYPE html>
<html><head>
<title>  Generics in Go | Example Blog </title>
<meta name="description" content="A gentle intro to generics.">
<script>var tracking = "SECRET_SCRIPT";</script>
<style>.x{color:red}</style>
</head>
<body>
<header class="site-header"><a href="/">Example Blog</a></header>
<nav><a href="/about">About</a> <a href="/contact">Contact</a></nav>
<div id="cookie-banner">We use cookies. <button>Accept</button></div>
<main>
<article>
  <h1>Generics <a href="#intro">in Go</a></h1>
  <p>Go 1.18   added <strong>type parameters</strong>. See the
     <a href="/doc/spec">language spec</a> and <a href="https://go.dev/blog">the blog</a>.</p>
  <script>document.write("SECRET_INLINE")</script>
  <h2>Why generics</h2>
  <ul>
    <li>Less duplication</li>
    <li>Type safety
      <ul><li>Nested item</li></ul>
    </li>
  </ul>
  <ol start="3"><li>three</li><li>four</li></ol>
  <blockquote><p>Quoted wisdom.</p></blockquote>
  <pre><code class="language-go">func Map[T any](s []T) []T {
	return s
}</code></pre>
  <p>Use <code>any</code> as a constraint.<br>New line here.</p>
  <img src="/img/diagram.png" alt="Diagram of generics">
  <img src="/img/spacer.gif">
  <a href="/empty"></a>
  <table>
    <tr><th>Name</th><th>Kind</th></tr>
    <tr><td>T</td><td>type | param</td></tr>
  </table>
  <div class="sidebar">Popular posts SIDEBAR_TEXT</div>
  <div class="comments">COMMENT_TEXT</div>
</article>
</main>
<aside>ASIDE_TEXT</aside>
<footer>FOOTER_TEXT</footer>
</body></html>`

func TestFetchReadability(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, articleFixture)
	})
	c := testClient(t)
	page, err := c.Fetch(context.Background(), srv.URL+"/posts/generics", 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Title != "Generics in Go | Example Blog" {
		t.Errorf("title = %q", page.Title)
	}
	if page.Description != "A gentle intro to generics." {
		t.Errorf("description = %q", page.Description)
	}
	if page.Status != 200 || page.ContentType != "text/html" || page.Truncated {
		t.Errorf("status %d type %q truncated %v", page.Status, page.ContentType, page.Truncated)
	}
	if page.FinalURL != srv.URL+"/posts/generics" {
		t.Errorf("final url = %q", page.FinalURL)
	}
	text := page.Text
	for _, bad := range []string{"SECRET", "color:red", "cookies", "Accept", "About", "SIDEBAR_TEXT",
		"COMMENT_TEXT", "ASIDE_TEXT", "FOOTER_TEXT", "Example Blog", "spacer", "/empty", "\n\n\n"} {
		if strings.Contains(text, bad) {
			t.Errorf("text should not contain %q:\n%s", bad, text)
		}
	}
	for _, want := range []string{
		"# Generics in Go\n\n",
		"Go 1.18 added type parameters. See the [language spec](" + srv.URL + "/doc/spec) and [the blog](https://go.dev/blog).",
		"\n\n## Why generics\n\n",
		"- Less duplication\n- Type safety\n  - Nested item",
		"3. three\n4. four",
		"> Quoted wisdom.",
		"```go\nfunc Map[T any](s []T) []T {\n\treturn s\n}\n```",
		"Use `any` as a constraint.\nNew line here.",
		"![Diagram of generics](" + srv.URL + "/img/diagram.png)",
		"| Name | Kind |\n| --- | --- |\n| T | type \\| param |",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("text missing %q:\n%s", want, text)
		}
	}
	if !strings.HasPrefix(text, "# Generics in Go") {
		t.Errorf("text should start with the article heading:\n%s", text)
	}
	wantLinks := []Link{
		{Text: "language spec", URL: srv.URL + "/doc/spec"},
		{Text: "the blog", URL: "https://go.dev/blog"},
	}
	if len(page.Links) != len(wantLinks) {
		t.Fatalf("links = %+v", page.Links)
	}
	for i := range wantLinks {
		if page.Links[i] != wantLinks[i] {
			t.Errorf("link %d = %+v, want %+v", i, page.Links[i], wantLinks[i])
		}
	}
}

func TestFetchFallsBackToMainAndBody(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		switch r.URL.Path {
		case "/main":
			io.WriteString(w, `<html><head><meta property="og:title" content="OG Title"><meta property="og:description" content="OG desc"></head>
<body><div>OUTSIDE</div><main><p>Inside main.</p></main></body></html>`)
		default:
			io.WriteString(w, `<html><body><nav>NAV</nav><div><p>Body text.</p></div></body></html>`)
		}
	})
	c := testClient(t)
	page, err := c.Fetch(context.Background(), srv.URL+"/main", 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Text != "Inside main." || page.Title != "OG Title" || page.Description != "OG desc" {
		t.Errorf("page = %+v", page)
	}
	page, err = c.Fetch(context.Background(), srv.URL+"/body", 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Text != "Body text." {
		t.Errorf("text = %q", page.Text)
	}
}

func TestFetchTruncationJSONAndText(t *testing.T) {
	long := strings.Repeat("word ", 5000)
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/long":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintf(w, "<html><body><p>%s</p></body></html>", long)
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"a":1,"b":[true,null]}`)
		case "/txt":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			io.WriteString(w, "  plain\n\n\n text  ")
		case "/latin1":
			w.Header().Set("Content-Type", "text/html; charset=ISO-8859-1")
			w.Write([]byte("<html><body><p>caf\xe9 na\xefve</p></body></html>"))
		}
	})
	c := testClient(t)
	page, err := c.Fetch(context.Background(), srv.URL+"/long", 100)
	if err != nil {
		t.Fatal(err)
	}
	if !page.Truncated || len([]rune(page.Text)) > 100 || !strings.HasPrefix(page.Text, "word word") {
		t.Errorf("truncated=%v len=%d text=%q", page.Truncated, len(page.Text), page.Text)
	}
	if strings.HasSuffix(page.Text, " ") || strings.HasSuffix(page.Text, "wor") {
		t.Errorf("cut mid-word: %q", page.Text)
	}

	page, err = c.Fetch(context.Background(), srv.URL+"/json", 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Text != "{\n  \"a\": 1,\n  \"b\": [\n    true,\n    null\n  ]\n}" || page.ContentType != "application/json" {
		t.Errorf("json text = %q", page.Text)
	}

	page, err = c.Fetch(context.Background(), srv.URL+"/txt", 0)
	if err != nil || page.Text != "  plain\n\n\n text  " {
		t.Errorf("text = %q err %v", page.Text, err)
	}

	page, err = c.Fetch(context.Background(), srv.URL+"/latin1", 0)
	if err != nil || page.Text != "café naïve" {
		t.Errorf("latin1 text = %q err %v", page.Text, err)
	}
}

func TestFetchErrors(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/pdf":
			w.Header().Set("Content-Type", "application/pdf")
			io.WriteString(w, "%PDF-1.4")
		case "/png":
			w.Header().Del("Content-Type")
			w.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"))
		case "/missing":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, "<p>Not here</p>")
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		}
	})
	c := testClient(t)
	ctx := context.Background()
	if _, err := c.Fetch(ctx, srv.URL+"/pdf", 0); err == nil || err.Error() != "unsupported content type: application/pdf" {
		t.Errorf("pdf err = %v", err)
	}
	if _, err := c.Fetch(ctx, srv.URL+"/png", 0); err == nil || err.Error() != "unsupported content type: image/png" {
		t.Errorf("png err = %v", err)
	}
	page, err := c.Fetch(ctx, srv.URL+"/missing", 0)
	if err == nil || err.Error() != "HTTP 404 Not Found" || page.Status != 404 || page.Text != "Not here" {
		t.Errorf("404: err %v page %+v", err, page)
	}
	if _, err := c.Fetch(ctx, srv.URL+"/loop", 0); err == nil || err.Error() != "too many redirects (max 5)" {
		t.Errorf("loop err = %v", err)
	}
	if _, err := c.Fetch(ctx, "ftp://example.com/x", 0); err == nil || !strings.Contains(err.Error(), "unsupported URL scheme") {
		t.Errorf("ftp err = %v", err)
	}
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := c.Fetch(cctx, srv.URL+"/pdf", 0); err == nil || err.Error() != "request canceled" {
		t.Errorf("canceled err = %v", err)
	}
}

func TestPrivateAddressBlocked(t *testing.T) {
	hit := false
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		hit = true
		io.WriteString(w, "secret")
	})
	c := New() // AllowPrivate is off
	u, _ := url.Parse(srv.URL)
	want := "blocked: " + u.Hostname() + " resolves to a private or local address"

	if _, err := c.Fetch(context.Background(), srv.URL, 0); err == nil || err.Error() != want {
		t.Errorf("Fetch err = %v, want %q", err, want)
	}
	if _, err := c.Do(context.Background(), Request{URL: srv.URL}); err == nil || err.Error() != want {
		t.Errorf("Do err = %v, want %q", err, want)
	}
	// Hostnames are checked after resolution.
	lh := "http://localhost:" + u.Port() + "/"
	if _, err := c.Fetch(context.Background(), lh, 0); err == nil || err.Error() != "blocked: localhost resolves to a private or local address" {
		t.Errorf("localhost err = %v", err)
	}
	if hit {
		t.Error("blocked request reached the server")
	}

}

func TestIsForbidden(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
		"169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1",
		"fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::a00:1"} {
		if !isForbidden(mustAddr(t, s)) {
			t.Errorf("%s should be forbidden", s)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "100.128.0.1", "2606:4700::1111", "64:ff9b::808:808"} {
		if isForbidden(mustAddr(t, s)) {
			t.Errorf("%s should be allowed", s)
		}
	}
}

func mustAddr(t *testing.T, s string) netip.Addr {
	t.Helper()
	a, err := netip.ParseAddr(s)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestDo(t *testing.T) {
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/echo":
			b, _ := io.ReadAll(r.Body)
			w.Header().Set("X-Method", r.Method)
			w.Header().Add("X-Multi", "one")
			w.Header().Add("X-Multi", "two")
			w.Header().Set("X-Custom-In", r.Header.Get("X-Custom"))
			w.Header().Set("X-Conn-In", r.Header.Get("Proxy-Authorization"))
			w.WriteHeader(http.StatusCreated)
			fmt.Fprintf(w, "got:%s", b)
		case "/bin":
			w.Write([]byte{0xff, 0xfe, 0x00, 0x01})
		case "/big":
			w.Write([]byte(strings.Repeat("é", maxDoBody))) // 2 bytes per rune
		case "/redir":
			http.Redirect(w, r, "/echo", http.StatusFound)
		}
	})
	c := testClient(t)
	ctx := context.Background()

	res, err := c.Do(ctx, Request{
		Method:  "post",
		URL:     srv.URL + "/echo",
		Headers: map[string]string{"X-Custom": "yes", "Host": "evil.example", "Proxy-Authorization": "x"},
		Body:    "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != 201 || res.StatusText != "Created" || res.Body != "got:hello" {
		t.Errorf("res = %+v", res)
	}
	if res.Headers["x-method"] != "POST" || res.Headers["x-multi"] != "one" ||
		res.Headers["x-custom-in"] != "yes" || res.Headers["x-conn-in"] != "" {
		t.Errorf("headers = %v", res.Headers)
	}

	res, err = c.Do(ctx, Request{URL: srv.URL + "/bin"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Headers[BodyEncodingHeader] != "base64" || res.Body != base64.StdEncoding.EncodeToString([]byte{0xff, 0xfe, 0x00, 0x01}) {
		t.Errorf("binary res = %+v", res)
	}

	res, err = c.Do(ctx, Request{URL: srv.URL + "/big"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated || len(res.Body) != maxDoBody || res.Headers[BodyEncodingHeader] != "" {
		t.Errorf("big: truncated %v len %d enc %q", res.Truncated, len(res.Body), res.Headers[BodyEncodingHeader])
	}

	res, err = c.Do(ctx, Request{Method: "HEAD", URL: srv.URL + "/redir"})
	if err != nil || res.FinalURL != srv.URL+"/echo" || res.Body != "" {
		t.Errorf("head redirect: %+v err %v", res, err)
	}

	if _, err := c.Do(ctx, Request{Method: "TRACE", URL: srv.URL}); err == nil || err.Error() != "method TRACE is not allowed" {
		t.Errorf("trace err = %v", err)
	}
	if _, err := c.Do(ctx, Request{URL: srv.URL, Headers: map[string]string{"cookie": "a=b"}}); err == nil ||
		!strings.Contains(err.Error(), "Cookie") {
		t.Errorf("cookie err = %v", err)
	}
	if _, err := c.Do(ctx, Request{URL: "file:///etc/passwd"}); err == nil {
		t.Error("file URL should fail")
	}
}

func TestDoTimeout(t *testing.T) {
	block := make(chan struct{})
	srv := serve(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-block:
		case <-r.Context().Done():
		}
	})
	defer close(block)
	c := testClient(t)
	if _, err := c.Do(context.Background(), Request{URL: srv.URL, TimeoutMs: 50}); err == nil || err.Error() != "request timed out" {
		t.Errorf("err = %v", err)
	}
}
