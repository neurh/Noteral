package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const (
	defaultSearchLimit = 8
	maxSearchLimit     = 20
	searchTimeout      = 15 * time.Second
	maxSearchBody      = 2 << 20
)

// SearchResult is a single web search hit.
type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"`
}

// SearchResponse is the outcome of Search. Engine names the backend that
// produced the results: "duckduckgo", "duckduckgo-lite" or "wikipedia".
type SearchResponse struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
	Engine  string         `json:"engine"`
}

type searchEngine struct {
	name string
	run  func(ctx context.Context, query string, limit int) ([]SearchResult, error)
}

// Search runs a keyless web search. It tries DuckDuckGo's HTML endpoint,
// then DuckDuckGo Lite, then Wikipedia, moving on whenever an engine fails,
// is blocked by a captcha, or returns nothing. limit defaults to 8, max 20.
func (c *Client) Search(ctx context.Context, query string, limit int) (SearchResponse, error) {
	query = strings.Join(strings.Fields(query), " ")
	resp := SearchResponse{Query: query, Results: []SearchResult{}}
	if query == "" {
		return resp, errors.New("empty search query")
	}
	limit = clampInt(limit, defaultSearchLimit, maxSearchLimit)

	engines := []searchEngine{
		{"duckduckgo", c.searchDDGHTML},
		{"duckduckgo-lite", c.searchDDGLite},
		{"wikipedia", c.searchWikipedia},
	}
	var failures []string
	answered := ""
	for _, e := range engines {
		if err := ctx.Err(); err != nil {
			return resp, humanize(ctx, err)
		}
		results, err := e.run(ctx, query, limit)
		if err != nil {
			if ctx.Err() != nil {
				return resp, humanize(ctx, err)
			}
			failures = append(failures, e.name+": "+err.Error())
			continue
		}
		if answered == "" {
			answered = e.name
		}
		if len(results) > 0 {
			if len(results) > limit {
				results = results[:limit]
			}
			resp.Results = results
			resp.Engine = e.name
			return resp, nil
		}
	}
	if answered != "" {
		// At least one engine worked but nothing matched.
		resp.Engine = answered
		return resp, nil
	}
	return resp, errors.New("search failed (" + strings.Join(failures, "; ") + ")")
}

// --- DuckDuckGo ---------------------------------------------------------

// postSearchForm submits a DuckDuckGo search form. challenged reports a
// bot-check page, which only matters when it yielded no results.
func (c *Client) postSearchForm(ctx context.Context, endpoint, referer, query string) (doc *html.Node, challenged bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	form := url.Values{"q": {query}, "kl": {"wt-wt"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", referer)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, false, humanize(ctx, err)
	}
	defer res.Body.Close()
	body, _, err := readLimited(res.Body, maxSearchBody)
	if err != nil {
		return nil, false, humanize(ctx, err)
	}
	challenged = isDDGChallenge(body)
	if res.StatusCode != http.StatusOK {
		// DuckDuckGo answers rate-limited clients with 202 and a challenge.
		if challenged {
			return nil, true, errors.New("blocked by captcha")
		}
		return nil, false, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	doc, err = html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, challenged, errors.New("could not parse results page")
	}
	return doc, challenged, nil
}

func isDDGChallenge(body []byte) bool {
	s := string(body)
	return strings.Contains(s, "anomaly-modal") ||
		strings.Contains(s, "challenge-form") ||
		strings.Contains(s, "bots use DuckDuckGo too")
}

func (c *Client) searchDDGHTML(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	doc, challenged, err := c.postSearchForm(ctx, c.ddgHTMLURL, "https://html.duckduckgo.com/", query)
	if err != nil {
		return nil, err
	}
	results := parseDDGHTML(doc, limit)
	if len(results) == 0 && challenged {
		return nil, errors.New("blocked by captcha")
	}
	return results, nil
}

func parseDDGHTML(doc *html.Node, limit int) []SearchResult {
	var out []SearchResult
	seen := map[string]bool{}
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if len(out) >= limit {
			return
		}
		if n.Type == html.ElementNode && hasClass(n, "result") {
			if hasClass(n, "result--ad") || hasClass(n, "result--no-result") {
				return
			}
			a := findFirst(n, func(m *html.Node) bool { return m.Data == "a" && hasClass(m, "result__a") })
			if a == nil {
				return
			}
			link := decodeDDGHref(attr(a, "href"))
			if link == "" || seen[link] {
				return
			}
			title := collapseSpace(textContent(a))
			if title == "" {
				return
			}
			snippet := ""
			if sn := findFirst(n, func(m *html.Node) bool { return hasClass(m, "result__snippet") }); sn != nil {
				snippet = collapseSpace(textContent(sn))
			}
			seen[link] = true
			out = append(out, SearchResult{Title: title, URL: link, Snippet: snippet, Source: hostOf(link)})
			return
		}
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(doc)
	return out
}

func (c *Client) searchDDGLite(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	doc, challenged, err := c.postSearchForm(ctx, c.ddgLiteURL, "https://lite.duckduckgo.com/", query)
	if err != nil {
		return nil, err
	}
	results := parseDDGLite(doc, limit)
	if len(results) == 0 && challenged {
		return nil, errors.New("blocked by captcha")
	}
	return results, nil
}

// parseDDGLite walks the table-based lite page in document order: each
// a.result-link opens a result, the following td.result-snippet fills it.
func parseDDGLite(doc *html.Node, limit int) []SearchResult {
	var out []SearchResult
	seen := map[string]bool{}
	current := -1 // index into out of the result awaiting a snippet
	var walk func(n *html.Node, sponsored bool)
	walk = func(n *html.Node, sponsored bool) {
		if n.Type == html.ElementNode {
			if hasClass(n, "result-sponsored") {
				sponsored = true
			}
			switch {
			case n.Data == "a" && hasClass(n, "result-link"):
				current = -1
				if sponsored || len(out) >= limit {
					return
				}
				link := decodeDDGHref(attr(n, "href"))
				title := collapseSpace(textContent(n))
				if link == "" || title == "" || seen[link] {
					return
				}
				seen[link] = true
				out = append(out, SearchResult{Title: title, URL: link, Source: hostOf(link)})
				current = len(out) - 1
				return
			case hasClass(n, "result-snippet"):
				if current >= 0 && out[current].Snippet == "" {
					out[current].Snippet = collapseSpace(textContent(n))
				}
				return
			}
		}
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch, sponsored)
		}
	}
	walk(doc, false)
	return out
}

// decodeDDGHref unwraps DuckDuckGo redirect links
// ("//duckduckgo.com/l/?uddg=<escaped>") and drops ad redirects. It returns
// "" for anything that is not an absolute http(s) URL.
func decodeDDGHref(href string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "//") {
		href = "https:" + href
	} else if strings.HasPrefix(href, "/") {
		href = "https://duckduckgo.com" + href
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if strings.HasSuffix(u.Hostname(), "duckduckgo.com") {
		if target := u.Query().Get("uddg"); target != "" {
			u, err = url.Parse(target)
			if err != nil {
				return ""
			}
		} else {
			return "" // internal link or ad redirect (y.js)
		}
	}
	if u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return ""
	}
	return u.String()
}

// --- Wikipedia ----------------------------------------------------------

func (c *Client) searchWikipedia(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	params := url.Values{
		"action":   {"query"},
		"list":     {"search"},
		"srsearch": {query},
		"format":   {"json"},
		"srlimit":  {strconv.Itoa(limit)},
		"utf8":     {"1"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.wikiAPIURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	// Wikimedia asks API clients to identify themselves.
	req.Header.Set("User-Agent", appUserAgent)
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, humanize(ctx, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	body, _, err := readLimited(res.Body, maxSearchBody)
	if err != nil {
		return nil, humanize(ctx, err)
	}
	var payload struct {
		Query struct {
			Search []struct {
				Title   string `json:"title"`
				Snippet string `json:"snippet"`
			} `json:"search"`
		} `json:"query"`
		Error *struct {
			Info string `json:"info"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("invalid response")
	}
	if payload.Error != nil {
		return nil, errors.New(payload.Error.Info)
	}
	out := make([]SearchResult, 0, len(payload.Query.Search))
	for _, s := range payload.Query.Search {
		if s.Title == "" {
			continue
		}
		link := c.wikiPageURL + wikiTitlePath(s.Title)
		out = append(out, SearchResult{
			Title:   s.Title,
			URL:     link,
			Snippet: stripTags(s.Snippet),
			Source:  hostOf(link),
		})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func wikiTitlePath(title string) string {
	// Escape like Wikipedia does: keep "()", "/", ":" etc. readable.
	const keep = "-._~!$&'()*+,/:;=@"
	var b strings.Builder
	for _, c := range []byte(strings.ReplaceAll(title, " ", "_")) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte(keep, c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// stripTags removes markup (e.g. <span class="searchmatch">) and decodes
// entities.
func stripTags(s string) string {
	z := html.NewTokenizer(strings.NewReader(s))
	var b strings.Builder
	for {
		switch z.Next() {
		case html.ErrorToken:
			return collapseSpace(b.String())
		case html.TextToken:
			b.Write(z.Text())
		}
	}
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}
