package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	fetchTimeout    = 20 * time.Second
	maxFetchBody    = 3 << 20
	defaultMaxChars = 20000
	maxMaxChars     = 100000
	maxPageLinks    = 40
)

// Link is a hyperlink found in a page's main content.
type Link struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

// Page is a fetched document reduced to readable text.
type Page struct {
	URL         string `json:"url"`
	FinalURL    string `json:"finalUrl"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ContentType string `json:"contentType"`
	Text        string `json:"text"` // Markdown-ish readable content
	Links       []Link `json:"links"`
	Truncated   bool   `json:"truncated"`
	Status      int    `json:"status"`
}

// Fetch downloads rawURL and extracts its readable content. HTML is turned
// into Markdown-like text; JSON is pretty-printed; other text types are
// returned as-is. maxChars defaults to 20000 and is capped at 100000.
//
// A 4xx/5xx response still yields the extracted Page together with an
// "HTTP <code>" error.
func (c *Client) Fetch(ctx context.Context, rawURL string, maxChars int) (Page, error) {
	maxChars = clampInt(maxChars, defaultMaxChars, maxMaxChars)
	u, err := parseHTTPURL(rawURL)
	if err != nil {
		return Page{URL: rawURL, Links: []Link{}}, err
	}
	page := Page{URL: u.String(), Links: []Link{}}

	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return page, errors.New("invalid URL")
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	res, err := c.http.Do(req)
	if err != nil {
		return page, humanize(ctx, err)
	}
	defer res.Body.Close()
	page.Status = res.StatusCode
	page.FinalURL = res.Request.URL.String()

	body, bodyTruncated, err := readLimited(res.Body, maxFetchBody)
	if err != nil {
		return page, humanize(ctx, err)
	}

	ctHeader := res.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(ctHeader)
	if mediaType == "" {
		mediaType, _, _ = mime.ParseMediaType(http.DetectContentType(body))
	}
	mediaType = strings.ToLower(mediaType)
	page.ContentType = mediaType

	var text string
	switch {
	case mediaType == "text/html" || mediaType == "application/xhtml+xml":
		body = toUTF8(body, ctHeader, true)
		doc, err := html.Parse(bytes.NewReader(body))
		if err != nil {
			return page, errors.New("could not parse HTML")
		}
		ex := extract(doc, res.Request.URL)
		page.Title, page.Description, text = ex.title, ex.description, ex.text
		if ex.links != nil {
			page.Links = ex.links
		}
	case isJSONType(mediaType):
		body = toUTF8(body, ctHeader, false)
		var buf bytes.Buffer
		if !bodyTruncated && json.Indent(&buf, bytes.TrimSpace(body), "", "  ") == nil {
			text = buf.String()
		} else {
			text = string(body)
		}
	case strings.HasPrefix(mediaType, "text/") || isXMLType(mediaType):
		text = string(toUTF8(body, ctHeader, false))
	default:
		return page, fmt.Errorf("unsupported content type: %s", mediaType)
	}

	text = strings.ToValidUTF8(text, "�")
	text, cut := truncateRunes(text, maxChars)
	page.Text = text
	page.Truncated = cut || bodyTruncated
	if res.StatusCode >= 400 {
		return page, fmt.Errorf("HTTP %d %s", res.StatusCode, http.StatusText(res.StatusCode))
	}
	return page, nil
}

func isJSONType(t string) bool {
	return t == "application/json" || strings.HasSuffix(t, "+json") || t == "text/json"
}

func isXMLType(t string) bool {
	return t == "application/xml" || strings.HasSuffix(t, "+xml") ||
		t == "application/javascript" || t == "application/ecmascript"
}

// toUTF8 converts body to UTF-8 using the declared charset (and, for HTML,
// a <meta charset> sniff). Unknown or UTF-8 encodings are passed through.
func toUTF8(body []byte, contentType string, sniffHTML bool) []byte {
	var name string
	if sniffHTML {
		_, name, _ = charset.DetermineEncoding(body, contentType)
	} else if _, params, err := mime.ParseMediaType(contentType); err == nil {
		name = params["charset"]
	}
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" || name == "utf-8" || name == "utf8" || name == "us-ascii" || name == "ascii" {
		return body
	}
	if utf8.Valid(body) && !sniffHTML {
		// A plain-text body that is already valid UTF-8 is safest as-is.
		return body
	}
	enc, _ := charset.Lookup(name)
	if enc == nil {
		return body
	}
	out, err := enc.NewDecoder().Bytes(body)
	if err != nil {
		return body
	}
	return out
}

// truncateRunes shortens s to at most n runes, preferring a line or word
// boundary near the cut.
func truncateRunes(s string, n int) (string, bool) {
	if utf8.RuneCountInString(s) <= n {
		return s, false
	}
	cut := 0
	for i := range s {
		if n == 0 {
			cut = i
			break
		}
		n--
	}
	head := s[:cut]
	if i := strings.LastIndexAny(head, "\n "); i > 0 && i > len(head)-300 {
		head = head[:i]
	}
	return strings.TrimRight(head, " \n\t"), true
}
