// Package web implements the keyless web tools used by the in-app assistant
// (search and page fetching) and the generic HTTP access granted to plugins
// with the "network" permission.
//
// Every connection goes through a dialer that refuses private, loopback,
// link-local and other local destinations. The check runs on the resolved IP
// at dial time (net.Dialer.Control), so neither redirects nor DNS rebinding
// can be used to reach the local machine or the LAN.
package web

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
	appUserAgent     = "Noteral/1.0 (desktop notes app)"
	maxRedirects     = 5
)

// Client performs outbound HTTP for the web tools. The zero value is not
// usable; construct one with New. A Client is safe for concurrent use.
type Client struct {
	http         *http.Client
	userAgent    string // sent on search and fetch requests
	allowPrivate atomic.Bool

	// Endpoints, overridable in tests.
	ddgHTMLURL  string
	ddgLiteURL  string
	wikiAPIURL  string
	wikiPageURL string // article base, title is appended
}

// New returns a Client that refuses to connect to private or local addresses.
func New() *Client {
	c := &Client{
		userAgent:   browserUserAgent,
		ddgHTMLURL:  "https://html.duckduckgo.com/html/",
		ddgLiteURL:  "https://lite.duckduckgo.com/lite/",
		wikiAPIURL:  "https://en.wikipedia.org/w/api.php",
		wikiPageURL: "https://en.wikipedia.org/wiki/",
	}
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   c.controlConn,
	}
	transport := &http.Transport{
		// No proxy: a proxy would dial on our behalf and bypass the
		// address guard.
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, err := dialer.DialContext(ctx, network, addr)
			if err != nil {
				var be *blockedError
				if errors.As(err, &be) {
					host, _, splitErr := net.SplitHostPort(addr)
					if splitErr != nil {
						host = addr
					}
					return nil, &blockedError{host: host}
				}
			}
			return conn, err
		},
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	c.http = &http.Client{
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects (max %d)", maxRedirects)
			}
			if s := req.URL.Scheme; s != "http" && s != "https" {
				return fmt.Errorf("redirect to unsupported URL scheme %q", s)
			}
			return nil
		},
	}
	return c
}

// SetAllowPrivate toggles access to private and local addresses. It exists
// for tests (httptest servers listen on 127.0.0.1); production code should
// leave it off.
func (c *Client) SetAllowPrivate(v bool) { c.allowPrivate.Store(v) }

// blockedError is returned when a destination resolves to a forbidden address.
type blockedError struct{ host string }

func (e *blockedError) Error() string {
	return "blocked: " + e.host + " resolves to a private or local address"
}

var (
	cgnatPrefix    = netip.MustParsePrefix("100.64.0.0/10")
	thisNetPrefix  = netip.MustParsePrefix("0.0.0.0/8")
	metadataAddr   = netip.MustParseAddr("169.254.169.254")
	broadcastAddr  = netip.MustParseAddr("255.255.255.255")
	ulaPrefix      = netip.MustParsePrefix("fc00::/7")
	siteLocalV6    = netip.MustParsePrefix("fec0::/10")
	nat64Prefix    = netip.MustParsePrefix("64:ff9b::/96")
	errBlockedDial = &blockedError{}
)

// isForbidden reports whether ip must not be dialled.
func isForbidden(ip netip.Addr) bool {
	ip = ip.Unmap()
	if nat64Prefix.Contains(ip) {
		// Well-known NAT64 prefix embeds an IPv4 address in the low 32 bits.
		b := ip.As16()
		ip = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	switch {
	case !ip.IsValid(),
		ip.IsLoopback(),
		ip.IsPrivate(),
		ip.IsLinkLocalUnicast(),
		ip.IsLinkLocalMulticast(),
		ip.IsInterfaceLocalMulticast(),
		ip.IsMulticast(),
		ip.IsUnspecified(),
		ip == metadataAddr,
		ip == broadcastAddr,
		cgnatPrefix.Contains(ip),
		thisNetPrefix.Contains(ip),
		ulaPrefix.Contains(ip),
		siteLocalV6.Contains(ip):
		return true
	}
	return false
}

// controlConn runs after DNS resolution, right before connect(2), with the
// literal IP being dialled.
func (c *Client) controlConn(network, address string, _ syscall.RawConn) error {
	if c.allowPrivate.Load() {
		return nil
	}
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return errBlockedDial
	}
	if isForbidden(ap.Addr()) {
		return errBlockedDial
	}
	return nil
}

// parseHTTPURL validates a user supplied URL. A missing scheme defaults to
// https so "example.com/page" works.
func parseHTTPURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("empty URL")
	}
	if !strings.Contains(raw, "://") && !strings.HasPrefix(strings.ToLower(raw), "mailto:") {
		raw = "https://" + strings.TrimPrefix(raw, "//")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %s", raw)
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("unsupported URL scheme %q (only http and https)", u.Scheme)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("invalid URL: missing host")
	}
	u.Fragment = ""
	return u, nil
}

// humanize turns transport errors into short messages suitable for users
// and language models.
func humanize(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	var be *blockedError
	if errors.As(err, &be) {
		return be
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			return errors.New("request timed out")
		}
		return errors.New("request canceled")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("request timed out")
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		if dnsErr.IsNotFound {
			return fmt.Errorf("could not resolve host %s", dnsErr.Name)
		}
		return fmt.Errorf("DNS lookup failed for %s", dnsErr.Name)
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return errors.New("connection refused")
	}
	if errors.Is(err, syscall.ECONNRESET) || errors.Is(err, io.ErrUnexpectedEOF) {
		return errors.New("connection reset by server")
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return errors.New("request timed out")
	}
	var certErr *tls.CertificateVerificationError
	if errors.As(err, &certErr) {
		return errors.New("TLS certificate verification failed")
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return errors.New(urlErr.Err.Error())
	}
	return err
}

// readLimited reads at most limit bytes and reports whether more remained.
func readLimited(r io.Reader, limit int64) ([]byte, bool, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return b, false, err
	}
	if int64(len(b)) > limit {
		return b[:limit], true, nil
	}
	return b, false, nil
}

func clampInt(v, def, max int) int {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}
