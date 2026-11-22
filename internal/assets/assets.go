// Package assets stores workspace-local attachments and serves them through a
// path-validated asset middleware.
package assets

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"noteral/internal/datadir"
)

const MaxBytes = 50 << 20

// Asset describes a stored attachment.
type Asset struct {
	URL          string `json:"url"`
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	ContentType  string `json:"contentType"`
	Size         int64  `json:"size"`
	IsImage      bool   `json:"isImage"`
}

// Manager owns the per-workspace assets directory.
type Manager struct {
	info datadir.Info
}

func New(info datadir.Info) *Manager { return &Manager{info: info} }

// Save writes bytes into workspaces/<id>/assets/<year>/<month>/.
func (m *Manager) Save(workspaceID, filename string, data []byte) (Asset, error) {
	if len(data) == 0 {
		return Asset{}, fmt.Errorf("empty file")
	}
	if len(data) > MaxBytes {
		return Asset{}, fmt.Errorf("file is larger than %d MB", MaxBytes>>20)
	}
	name := safeName(filename)
	ext := strings.ToLower(filepath.Ext(name))
	ct := contentType(ext)
	isImage := strings.HasPrefix(ct, "image/")
	if isImage && !validImage(ext, data) {
		return Asset{}, fmt.Errorf("that file does not look like a valid %s image", strings.TrimPrefix(ext, "."))
	}
	if !isImage && ct == "" {
		ct = http.DetectContentType(data)
	}
	now := time.Now()
	dir := filepath.Join(m.info.AssetsDir(workspaceID), fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Asset{}, err
	}
	var rnd [8]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return Asset{}, err
	}
	base := strings.TrimSuffix(name, filepath.Ext(name))
	if base == "" {
		base = "attachment"
	}
	if len([]rune(base)) > 70 {
		base = string([]rune(base)[:70])
	}
	stored := hex.EncodeToString(rnd[:]) + "-" + base + ext
	abs := filepath.Join(dir, stored)
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return Asset{}, err
	}
	rel := filepath.ToSlash(filepath.Join("assets", fmt.Sprintf("%04d", now.Year()), fmt.Sprintf("%02d", int(now.Month())), stored))
	return Asset{
		URL:          AssetURL(workspaceID, rel),
		Name:         name,
		RelativePath: rel,
		ContentType:  ct,
		Size:         int64(len(data)),
		IsImage:      isImage,
	}, nil
}

// AssetURL builds the middleware URL for a relative asset path.
func AssetURL(workspaceID, rel string) string {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return "/__assets/" + url.PathEscape(workspaceID) + "/" + strings.Join(parts, "/")
}

// RelativeFromURL strips a leading /__assets/<workspace>/ prefix.
func RelativeFromURL(workspaceID, raw string) string {
	prefix := "/__assets/" + workspaceID + "/"
	if strings.HasPrefix(raw, prefix) {
		return strings.TrimPrefix(raw, prefix)
	}
	return raw
}

// Resolve validates a relative asset path and returns an absolute path safe for
// serving. It rejects traversal and symlinks.
func (m *Manager) Resolve(workspaceID, rel string) (string, error) {
	if !validWorkspaceID(workspaceID) {
		return "", errors.New("invalid workspace")
	}
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "./")
	// Stored references are portable "assets/..." paths; the workspace asset
	// root already ends in /assets.
	rel = strings.TrimPrefix(rel, "assets/")
	rel = filepath.FromSlash(path.Clean("/" + rel))
	rel = strings.TrimPrefix(rel, string(filepath.Separator))
	if rel == "" || strings.Contains(rel, "..") || filepath.IsAbs(rel) {
		return "", errors.New("invalid asset path")
	}
	root := m.info.AssetsDir(workspaceID)
	abs := filepath.Join(root, rel)
	relCheck, err := filepath.Rel(root, abs)
	if err != nil || strings.HasPrefix(relCheck, "..") {
		return "", errors.New("invalid asset path")
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
		return "", errors.New("invalid asset")
	}
	return abs, nil
}

// ServeHTTP serves /__assets/<workspace>/<path>.
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/__assets/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	workspaceID, _ := url.PathUnescape(parts[0])
	rel, err := url.PathUnescape(parts[1])
	if err != nil {
		http.Error(w, "bad asset path", http.StatusBadRequest)
		return
	}
	abs, err := m.Resolve(workspaceID, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(filepath.Ext(abs))
	ct := contentType(ext)
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if !strings.HasPrefix(ct, "image/") {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(filepath.Base(abs), "\"", "")+"\"")
	}
	http.ServeContent(w, r, filepath.Base(abs), stat.ModTime(), f)
}

func validWorkspaceID(id string) bool {
	if id == "" || len(id) > 90 {
		return false
	}
	for i, r := range id {
		if i == 0 && !(r >= 'a' && r <= 'z') {
			return false
		}
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func contentType(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".avif":
		return "image/avif"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	case ".pdf":
		return "application/pdf"
	case ".txt", ".md":
		return "text/plain; charset=utf-8"
	case ".json":
		return "application/json"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return ""
}

func validImage(ext string, data []byte) bool {
	switch ext {
	case ".png":
		return len(data) > 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n"
	case ".jpg", ".jpeg":
		return len(data) > 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff
	case ".gif":
		return len(data) > 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a")
	case ".webp":
		return len(data) > 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	case ".avif":
		return len(data) > 12 && string(data[4:12]) == "ftypavif"
	case ".bmp":
		return len(data) > 2 && data[0] == 'B' && data[1] == 'M'
	}
	return false
}

func safeName(filename string) string {
	name := filepath.Base(strings.TrimSpace(filename))
	name = strings.Trim(name, ". ")
	if name == "" || name == "." || name == ".." {
		name = "attachment"
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '.' || r == '-' || r == '_' || r == ' ':
			b.WriteRune(r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	name = strings.Trim(strings.Join(strings.Fields(b.String()), " "), ". ")
	if name == "" {
		name = "attachment"
	}
	if len([]rune(name)) > 140 {
		name = string([]rune(name)[:140])
	}
	return name
}

// CopyTo copies a relative asset to a destination path, used by export.
func (m *Manager) CopyTo(workspaceID, rel, dest string) error {
	abs, err := m.Resolve(workspaceID, rel)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0o644)
}
