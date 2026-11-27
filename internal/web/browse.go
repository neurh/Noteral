package web

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// BrowsePage is a page loaded for the in-app browser: its readable content
// plus whether the site lets other origins show it in a frame.
type BrowsePage struct {
	Page
	// Embeddable is false when X-Frame-Options or a CSP frame-ancestors rule
	// forbids framing, so the browser must fall back to its reader view.
	Embeddable bool `json:"embeddable"`
	// FrameReason says why a page cannot be framed, for the UI.
	FrameReason string `json:"frameReason,omitempty"`
	// Readable is true when Text holds content worth showing in the reader.
	Readable bool `json:"readable"`
	// Error is a soft failure (an HTTP error page, an unsupported type) that
	// still produced a page.
	Error string `json:"error,omitempty"`
}

// maxBrowseChars is the most reader text the browser asks for.
const maxBrowseChars = maxMaxChars

// Browse fetches rawURL for the in-app browser. Unlike Fetch, responses that
// cannot be turned into text (images, PDFs) and HTTP error pages are still
// returned, with Error set, as long as the server answered.
func (c *Client) Browse(ctx context.Context, rawURL string) (BrowsePage, error) {
	page, header, err := c.fetch(ctx, rawURL, maxBrowseChars)
	out := BrowsePage{Page: page}
	if header == nil {
		if err == nil {
			err = errors.New("no response")
		}
		return out, err
	}
	out.Embeddable, out.FrameReason = frameable(header)
	out.Readable = strings.TrimSpace(page.Text) != ""
	if err != nil {
		if !errors.Is(err, errUnsupportedType) && page.Status < 400 {
			return out, err
		}
		out.Error = err.Error()
	}
	return out, nil
}

// frameable reports whether a response may be shown inside a frame on
// another origin, judging by X-Frame-Options and CSP frame-ancestors.
func frameable(h http.Header) (bool, string) {
	for _, policy := range h.Values("Content-Security-Policy") {
		for _, directive := range strings.Split(policy, ";") {
			fields := strings.Fields(strings.ToLower(directive))
			if len(fields) == 0 || fields[0] != "frame-ancestors" {
				continue
			}
			for _, source := range fields[1:] {
				if source == "*" || source == "https:" || source == "http:" {
					return true, ""
				}
			}
			return false, "This site only lets its own pages show it in a frame."
		}
	}
	for _, value := range h.Values("X-Frame-Options") {
		switch strings.ToUpper(strings.TrimSpace(value)) {
		case "DENY":
			return false, "This site refuses to be shown inside other apps."
		case "SAMEORIGIN":
			return false, "This site only lets its own pages show it in a frame."
		}
	}
	return true, ""
}
