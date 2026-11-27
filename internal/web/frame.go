package web

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"html/template"
	"mime"
	"net/http"
	"net/http/cookiejar"
	"regexp"
	"strings"
	"sync"
	"time"
)

// FramePath is where the app serves web pages for the in-app browser:
// GET /__browse?url=<address>.
//
// Most sites refuse to be framed by another origin (X-Frame-Options, CSP
// frame-ancestors), and a cross-origin frame never tells the app where it
// navigated. So the browser loads pages through this handler instead: the
// page is fetched by the same guarded client the web tools use (no private or
// local addresses, no cookies), its frame-blocking headers are dropped, and a
// small bridge script is put in front of the page's own markup. The bridge
// reports the address and title to the app and hands link clicks and GET
// forms back to it, so the address bar, history and tabs follow along.
//
// Every response carries a CSP sandbox without allow-same-origin, so the page
// runs in an opaque origin even though it is served from the app's own: it
// cannot reach the app, its storage or its bindings.
const FramePath = "/__browse"

const (
	frameTimeout = 25 * time.Second
	maxFrameBody = 8 << 20
	frameSandbox = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
)

//go:embed frame_bridge.js
var frameBridge string

// frameJar keeps the cookies browser pages set, in memory only, for as long
// as the app runs. Sites need them for consent screens and redirects; they
// are never shared with the assistant or plugin requests.
var (
	frameJarOnce sync.Once
	frameJar     http.CookieJar
)

func (c *Client) frameClient() *http.Client {
	frameJarOnce.Do(func() {
		jar, _ := cookiejar.New(nil)
		frameJar = jar
	})
	client := *c.http
	client.Jar = frameJar
	return &client
}

var headOpen = regexp.MustCompile(`(?i)<head(\s[^>]*)?>`)
var htmlOpen = regexp.MustCompile(`(?i)<html(\s[^>]*)?>`)

// ServeFrame implements FramePath.
func (c *Client) ServeFrame(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, ResourcePath) {
		c.serveResource(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Only the app itself may load pages through here.
	// A page reloading itself or a script moving it comes from the page's
	// opaque origin, which counts as cross-site; navigating a frame never
	// hands the response to the navigator, so those are fine too.
	dest := r.Header.Get("Sec-Fetch-Dest")
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" && dest != "iframe" && dest != "frame" && dest != "document" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	raw := r.URL.Query().Get("url")
	u, err := parseHTTPURL(raw)
	if err != nil {
		writeFrameError(w, raw, "This address can't be opened", err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), frameTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		writeFrameError(w, raw, "This address can't be opened", "invalid URL", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	if lang := r.Header.Get("Accept-Language"); lang != "" {
		req.Header.Set("Accept-Language", lang)
	} else {
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	}
	res, err := c.frameClient().Do(req)
	if err != nil {
		writeFrameError(w, u.String(), "This site can't be reached", humanize(ctx, err).Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	final := res.Request.URL.String()

	ctHeader := res.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(ctHeader)
	mediaType = strings.ToLower(mediaType)
	if mediaType != "" && mediaType != "text/html" && mediaType != "application/xhtml+xml" {
		// Images, PDFs, downloads: let the frame load them straight from the
		// site, which never blocks a direct load of a file.
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, final, http.StatusFound)
		return
	}

	body, _, err := readLimited(res.Body, maxFrameBody)
	if err != nil {
		writeFrameError(w, final, "This page didn't finish loading", humanize(ctx, err).Error(), http.StatusBadGateway)
		return
	}
	if mediaType == "" && !strings.HasPrefix(http.DetectContentType(body), "text/html") {
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, final, http.StatusFound)
		return
	}
	body = toUTF8(body, ctHeader, true)
	body = rewriteMarkup(body, res.Request.URL, appOrigin(r))

	setFrameHeaders(w, final)
	w.WriteHeader(res.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(injectBridge(body, final, res.StatusCode))
}

func setFrameHeaders(w http.ResponseWriter, final string) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", frameSandbox+"; frame-ancestors 'self'")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	if final != "" {
		h.Set("X-Noteral-Url", final)
	}
}

// injectBridge puts the base URL and the bridge script in front of the page's
// own markup, so relative links and assets resolve against the site and the
// bridge runs before any of the page's scripts.
func injectBridge(body []byte, final string, status int) []byte {
	config, _ := json.Marshal(map[string]any{"url": final, "status": status})
	prelude := `<meta charset="utf-8"><base href="` + template.HTMLEscapeString(final) + `">` +
		`<script>window.__noteralFrame=` + string(config) + `;` + frameBridge + `</script>`
	if loc := headOpen.FindIndex(body); loc != nil {
		return splice(body, loc[1], prelude)
	}
	if loc := htmlOpen.FindIndex(body); loc != nil {
		return splice(body, loc[1], "<head>"+prelude+"</head>")
	}
	return append([]byte("<!doctype html><head>"+prelude+"</head>"), body...)
}

func splice(body []byte, at int, insert string) []byte {
	var out bytes.Buffer
	out.Grow(len(body) + len(insert))
	out.Write(body[:at])
	out.WriteString(insert)
	out.Write(body[at:])
	return out.Bytes()
}

var frameErrorPage = template.Must(template.New("err").Parse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{.Title}}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:440px;padding:32px 20px;text-align:center}
h1{font-size:18px;margin:0 0 6px}
p{margin:0;opacity:.7;word-break:break-word}
code{font-size:12.5px;opacity:.75}
</style></head><body><main><h1>{{.Title}}</h1><p>{{.Detail}}</p>{{if .URL}}<p><code>{{.URL}}</code></p>{{end}}</main>
<script>window.__noteralFrame={{.Config}};{{.Bridge}}</script></body></html>`))

func writeFrameError(w http.ResponseWriter, rawURL, title, detail string, status int) {
	setFrameHeaders(w, "")
	w.WriteHeader(status)
	config := map[string]any{"url": rawURL, "status": status, "error": detail}
	_ = frameErrorPage.Execute(w, map[string]any{
		"Title":  title,
		"Detail": detail,
		"URL":    rawURL,
		"Config": config,
		"Bridge": template.JS(frameBridge),
	})
}
