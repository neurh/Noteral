package web

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultDoTimeout = 15 * time.Second
	maxDoTimeout     = 30 * time.Second
	maxDoBody        = 2 << 20

	// BodyEncodingHeader is set to "base64" in Response.Headers when the
	// response body was not valid UTF-8 and has been base64 encoded.
	BodyEncodingHeader = "x-noteral-body-encoding"
)

// Request is a generic HTTP request issued on behalf of a plugin.
type Request struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	TimeoutMs int               `json:"timeoutMs"`
}

// Response is the result of Do. Headers are flattened to their first value
// with lower-case keys.
type Response struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	Truncated  bool              `json:"truncated"`
	FinalURL   string            `json:"finalUrl"`
}

var allowedMethods = map[string]bool{
	http.MethodGet: true, http.MethodPost: true, http.MethodPut: true,
	http.MethodPatch: true, http.MethodDelete: true, http.MethodHead: true,
}

// Headers callers may not set: hop-by-hop headers and ones the transport owns.
var droppedHeaders = map[string]bool{
	"connection": true, "keep-alive": true, "proxy-authenticate": true,
	"proxy-authorization": true, "proxy-connection": true, "te": true,
	"trailer": true, "transfer-encoding": true, "upgrade": true,
	"host": true, "content-length": true,
}

// Do performs a generic HTTP request. Any HTTP status is a successful
// result; errors are reserved for invalid requests and transport failures.
func (c *Client) Do(ctx context.Context, r Request) (Response, error) {
	method := strings.ToUpper(strings.TrimSpace(r.Method))
	if method == "" {
		method = http.MethodGet
	}
	if !allowedMethods[method] {
		return Response{}, fmt.Errorf("method %s is not allowed", method)
	}
	u, err := parseHTTPURL(r.URL)
	if err != nil {
		return Response{}, err
	}

	timeout := defaultDoTimeout
	if r.TimeoutMs > 0 {
		timeout = min(time.Duration(r.TimeoutMs)*time.Millisecond, maxDoTimeout)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var body io.Reader
	if r.Body != "" && method != http.MethodHead {
		body = strings.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return Response{}, errors.New("invalid request")
	}
	for k, v := range r.Headers {
		key := strings.TrimSpace(k)
		lk := strings.ToLower(key)
		if lk == "cookie" {
			return Response{}, errors.New("the Cookie header is not allowed")
		}
		if droppedHeaders[lk] || key == "" {
			continue
		}
		if strings.ContainsAny(key+v, "\r\n") {
			return Response{}, fmt.Errorf("invalid header %q", key)
		}
		req.Header.Set(key, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", appUserAgent)
	}

	res, err := c.http.Do(req)
	if err != nil {
		return Response{}, humanize(ctx, err)
	}
	defer res.Body.Close()

	out := Response{
		Status:     res.StatusCode,
		StatusText: statusText(res),
		Headers:    make(map[string]string, len(res.Header)+1),
		FinalURL:   res.Request.URL.String(),
	}
	for k, vs := range res.Header {
		if len(vs) > 0 {
			out.Headers[strings.ToLower(k)] = vs[0]
		}
	}
	data, truncated, err := readLimited(res.Body, maxDoBody)
	if err != nil {
		return Response{}, humanize(ctx, err)
	}
	out.Truncated = truncated
	if truncated {
		// Don't let the cut split a multi-byte character.
		for i := 1; i <= utf8.UTFMax && i <= len(data); i++ {
			if utf8.RuneStart(data[len(data)-i]) {
				if !utf8.FullRune(data[len(data)-i:]) {
					data = data[:len(data)-i]
				}
				break
			}
		}
	}
	if utf8.Valid(data) {
		out.Body = string(data)
	} else {
		out.Body = base64.StdEncoding.EncodeToString(data)
		out.Headers[BodyEncodingHeader] = "base64"
	}
	return out, nil
}

func statusText(res *http.Response) string {
	if t := strings.TrimSpace(strings.TrimPrefix(res.Status, strconv.Itoa(res.StatusCode))); t != "" {
		return t
	}
	return http.StatusText(res.StatusCode)
}
