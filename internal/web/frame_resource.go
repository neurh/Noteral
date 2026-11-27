package web

import (
	"context"
	"html/template"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ResourcePath serves a page's subresources and requests for the in-app
// browser: /__browse/r/<scheme>/<host>/<path>?<query>.
//
// A framed page runs in an opaque origin ("null"). Classic scripts, images and
// stylesheets load from a site without asking it, but module scripts, fonts,
// fetch and XMLHttpRequest are CORS requests, and almost no site allows the
// "null" origin. Those go through here instead: the request is made by the
// same guarded client and cookie jar as the page, and the answer carries CORS
// headers that let the page read it. The path keeps the site's own layout so
// relative imports inside a module resolve the way the site expects.
const ResourcePath = FramePath + "/r/"

const maxResourceRequestBody = 8 << 20

// Request headers worth passing on. Cookies come from the jar, and the
// fetch metadata and origin headers describe the app, not the site.
var resourceRequestHeaders = map[string]bool{
	"Accept":            true,
	"Accept-Language":   true,
	"Authorization":     true,
	"Cache-Control":     true,
	"Content-Type":      true,
	"If-Match":          true,
	"If-Modified-Since": true,
	"If-None-Match":     true,
	"Pragma":            true,
	"Range":             true,
}

// Response headers that must not reach the page: the proxy decides framing,
// CORS, cookies and transfer encoding itself.
var resourceDroppedHeaders = map[string]bool{
	"Access-Control-Allow-Credentials": true,
	"Access-Control-Allow-Headers":     true,
	"Access-Control-Allow-Methods":     true,
	"Access-Control-Allow-Origin":      true,
	"Access-Control-Expose-Headers":    true,
	"Access-Control-Max-Age":           true,
	"Alt-Svc":                          true,
	"Connection":                       true,
	"Content-Encoding":                 true,
	"Content-Length":                   true,
	"Content-Security-Policy":          true,
	"Cross-Origin-Embedder-Policy":     true,
	"Cross-Origin-Opener-Policy":       true,
	"Cross-Origin-Resource-Policy":     true,
	"Keep-Alive":                       true,
	"Report-To":                        true,
	"Set-Cookie":                       true,
	"Strict-Transport-Security":        true,
	"Timing-Allow-Origin":              true,
	"Transfer-Encoding":                true,
	"X-Frame-Options":                  true,
}

// ResourceURL is the proxy path for an absolute http(s) address, or "" when
// the address is not one.
func ResourceURL(target string) string {
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	out := ResourcePath + u.Scheme + "/" + u.Host + path
	if u.RawQuery != "" {
		out += "?" + u.RawQuery
	}
	return out
}

// resourceTarget turns a proxy path back into the site address.
func resourceTarget(r *http.Request) (*url.URL, error) {
	rest := strings.TrimPrefix(r.URL.EscapedPath(), ResourcePath)
	scheme, rest, _ := strings.Cut(rest, "/")
	host, path, _ := strings.Cut(rest, "/")
	raw := scheme + "://" + host + "/" + path
	if r.URL.RawQuery != "" {
		raw += "?" + r.URL.RawQuery
	}
	return parseHTTPURL(raw)
}

// resourceOriginAllowed accepts the framed pages themselves (opaque "null"
// origin), the app, and requests that carry no origin. A real web origin is
// a site the app loaded directly, which must not use the browser's cookies.
func resourceOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

func setResourceCORS(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	} else {
		h.Set("Access-Control-Allow-Credentials", "true")
	}
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Expose-Headers", "*")
	h.Add("Vary", "Origin")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
}

// appOrigin is the origin the app itself is served from, which rewritten
// markup needs because the page's <base> points at the site. The app names it
// in the frame address; it must match the host the request came to.
func appOrigin(r *http.Request) string {
	if raw := r.URL.Query().Get("app"); raw != "" {
		if u, err := url.Parse(raw); err == nil && u.Scheme != "" && u.Host == r.Host {
			return u.Scheme + "://" + u.Host
		}
	}
	return "http://" + r.Host
}

func (c *Client) serveResource(w http.ResponseWriter, r *http.Request) {
	if !resourceOriginAllowed(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	setResourceCORS(w, r)
	if r.Method == http.MethodOptions {
		h := w.Header()
		if want := r.Header.Get("Access-Control-Request-Headers"); want != "" {
			h.Set("Access-Control-Allow-Headers", want)
		}
		h.Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
		h.Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	target, err := resourceTarget(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), frameTimeout)
	defer cancel()
	var body io.Reader
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		body = http.MaxBytesReader(w, r.Body, maxResourceRequestBody)
	}
	req, err := http.NewRequestWithContext(ctx, r.Method, target.String(), body)
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	for name, values := range r.Header {
		canonical := http.CanonicalHeaderKey(name)
		if resourceRequestHeaders[canonical] || (strings.HasPrefix(canonical, "X-") && canonical != "X-Noteral-Page") {
			req.Header[canonical] = values
		}
	}
	req.Header.Set("User-Agent", c.userAgent)
	// Sites check where a request comes from; answer for the page the
	// request belongs to, which the bridge names.
	if page, err := url.Parse(r.Header.Get("X-Noteral-Page")); err == nil && (page.Scheme == "http" || page.Scheme == "https") && page.Host != "" {
		req.Header.Set("Referer", page.Scheme+"://"+page.Host+"/")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			req.Header.Set("Origin", page.Scheme+"://"+page.Host)
		}
	}

	res, err := c.frameClient().Do(req)
	if err != nil {
		http.Error(w, humanize(ctx, err).Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	for name, values := range res.Header {
		if !resourceDroppedHeaders[http.CanonicalHeaderKey(name)] {
			w.Header()[name] = values
		}
	}
	w.Header().Set("X-Noteral-Url", res.Request.URL.String())

	mediaType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	rewrite := rewriterFor(strings.ToLower(mediaType))
	if rewrite == nil || r.Method == http.MethodHead {
		w.WriteHeader(res.StatusCode)
		if r.Method != http.MethodHead {
			_, _ = io.Copy(w, res.Body)
		}
		return
	}
	data, _, err := readLimited(res.Body, maxFrameBody)
	if err != nil {
		http.Error(w, humanize(ctx, err).Error(), http.StatusBadGateway)
		return
	}
	w.WriteHeader(res.StatusCode)
	_, _ = w.Write(rewrite(data, res.Request.URL))
}

func rewriterFor(mediaType string) func([]byte, *url.URL) []byte {
	switch {
	case strings.Contains(mediaType, "javascript") || mediaType == "text/ecmascript":
		return func(b []byte, base *url.URL) []byte { return rewriteModule(b, base, false, "") }
	case mediaType == "text/css":
		return rewriteCSS
	}
	return nil
}

// Module specifiers in static and dynamic imports and re-exports:
// `from "x"`, `import "x"`, `import("x")`.
var moduleSpecifier = regexp.MustCompile(`(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])((?:https?:)?/[^"'\s]*|\.{1,2}/[^"'\s]*)(["'])`)

// rewriteModule points a module's imports at the proxy. Relative specifiers
// already resolve through it from a proxied module, so only root-relative and
// absolute ones change, unless the module is inline in the page (whose base
// is the site itself) and every specifier needs the proxy.
func rewriteModule(body []byte, base *url.URL, inline bool, app string) []byte {
	return moduleSpecifier.ReplaceAllFunc(body, func(match []byte) []byte {
		parts := moduleSpecifier.FindSubmatch(match)
		spec := string(parts[3])
		if parts[2][0] != parts[4][0] {
			return match
		}
		if !inline && strings.HasPrefix(spec, ".") {
			return match
		}
		if strings.HasPrefix(spec, ResourcePath) {
			return match
		}
		ref, err := url.Parse(spec)
		if err != nil {
			return match
		}
		proxied := ResourceURL(base.ResolveReference(ref).String())
		if proxied == "" {
			return match
		}
		out := make([]byte, 0, len(match)+len(app)+len(proxied))
		out = append(out, parts[1]...)
		out = append(out, parts[2]...)
		out = append(out, app...)
		out = append(out, proxied...)
		out = append(out, parts[4]...)
		return out
	})
}

var cssURL = regexp.MustCompile(`url\(\s*(["']?)(/[^/"')][^"')]*|https?://[^"')]+)(["']?)\s*\)`)

// rewriteCSS sends root-relative and absolute url() references in a proxied
// stylesheet through the proxy too; relative ones already do.
func rewriteCSS(body []byte, base *url.URL) []byte {
	return cssURL.ReplaceAllFunc(body, func(match []byte) []byte {
		parts := cssURL.FindSubmatch(match)
		ref, err := url.Parse(string(parts[2]))
		if err != nil {
			return match
		}
		proxied := ResourceURL(base.ResolveReference(ref).String())
		if proxied == "" {
			return match
		}
		return []byte("url(" + string(parts[1]) + proxied + string(parts[3]) + ")")
	})
}

var (
	markupTag     = regexp.MustCompile(`(?is)<(script|link|img|video|audio|source)\b[^>]*>`)
	markupAttr    = regexp.MustCompile(`(?is)\s([a-z][a-z0-9_:-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?`)
	inlineModule  = regexp.MustCompile(`(?is)(<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>)(.*?)(</script>)`)
	scriptSrcAttr = regexp.MustCompile(`(?is)\ssrc\s*=`)
)

// rewriteMarkup adjusts a page's tags so they load from an opaque origin:
// module scripts and module preloads go through the proxy (they always use
// CORS), and crossorigin/integrity are dropped from everything else so the
// browser loads those without CORS, which every site allows.
func rewriteMarkup(body []byte, base *url.URL, app string) []byte {
	body = markupTag.ReplaceAllFunc(body, func(tag []byte) []byte {
		return rewriteTag(tag, base, app)
	})
	return inlineModule.ReplaceAllFunc(body, func(match []byte) []byte {
		parts := inlineModule.FindSubmatch(match)
		if scriptSrcAttr.Match(parts[1]) {
			return match
		}
		out := append([]byte{}, parts[1]...)
		out = append(out, rewriteModule(parts[2], base, true, app)...)
		return append(out, parts[3]...)
	})
}

func rewriteTag(tag []byte, base *url.URL, app string) []byte {
	s := string(tag)
	name := strings.ToLower(markupTag.FindStringSubmatch(s)[1])
	end := strings.LastIndex(s, ">")
	head := "<" + s[1:1+len(name)]
	inner := s[1+len(name) : end]
	tail := s[end:]

	type attr struct{ key, raw, value string }
	var attrs []attr
	for _, m := range markupAttr.FindAllStringSubmatch(inner, -1) {
		value := m[2]
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
			value = value[1 : len(value)-1]
		}
		attrs = append(attrs, attr{strings.ToLower(m[1]), m[0], value})
	}
	get := func(key string) (string, bool) {
		for _, a := range attrs {
			if a.key == key {
				return a.value, true
			}
		}
		return "", false
	}

	proxyKey := ""
	switch name {
	case "script":
		if t, _ := get("type"); strings.EqualFold(strings.TrimSpace(t), "module") {
			proxyKey = "src"
		}
	case "link":
		rel, _ := get("rel")
		as, _ := get("as")
		as = strings.ToLower(strings.TrimSpace(as))
		for _, r := range strings.Fields(strings.ToLower(rel)) {
			// Stylesheets go through the proxy too: the fonts they name
			// always load with CORS, and the proxy rewrites their url()s.
			if r == "modulepreload" || r == "stylesheet" || (r == "preload" && (as == "font" || as == "fetch" || as == "style" || as == "script")) {
				proxyKey = "href"
			}
		}
	}
	_, hasCORS := get("crossorigin")
	_, hasIntegrity := get("integrity")
	if proxyKey == "" && !hasCORS && !hasIntegrity {
		return tag
	}

	var b strings.Builder
	b.WriteString(head)
	for _, a := range attrs {
		switch {
		case a.key == "integrity":
			continue
		case a.key == "crossorigin" && proxyKey == "":
			continue
		case a.key == proxyKey:
			ref, err := url.Parse(strings.TrimSpace(htmlUnescape(a.value)))
			if err == nil {
				if proxied := ResourceURL(base.ResolveReference(ref).String()); proxied != "" {
					b.WriteString(" " + a.key + `="` + template.HTMLEscapeString(app+proxied) + `"`)
					continue
				}
			}
		}
		b.WriteString(a.raw)
	}
	b.WriteString(tail)
	return []byte(b.String())
}

var htmlEntities = strings.NewReplacer("&amp;", "&", "&quot;", `"`, "&#39;", "'", "&lt;", "<", "&gt;", ">")

func htmlUnescape(s string) string { return htmlEntities.Replace(s) }
