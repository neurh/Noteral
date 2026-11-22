package assets

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noteral/internal/datadir"
)

func testManager(t *testing.T) *Manager {
	t.Helper()
	info, err := datadir.Resolve(filepath.Join(t.TempDir(), "Data"))
	if err != nil {
		t.Fatal(err)
	}
	return New(info)
}

func TestSaveResolveAndServe(t *testing.T) {
	manager := testManager(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	asset, err := manager.Save("ws_test", "My Photo.png", png)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if !asset.IsImage || asset.ContentType != "image/png" {
		t.Fatalf("unexpected asset: %+v", asset)
	}
	if !strings.HasPrefix(asset.URL, "/__assets/ws_test/assets/") {
		t.Fatalf("unexpected URL: %s", asset.URL)
	}
	relative, err := url.PathUnescape(strings.TrimPrefix(asset.URL, "/__assets/ws_test/"))
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := manager.Resolve("ws_test", relative)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if !strings.HasSuffix(resolved, filepath.Base(asset.RelativePath)) {
		t.Fatalf("resolved wrong path: %s", resolved)
	}
	if got, err := os.ReadFile(resolved); err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored bytes differ: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, asset.URL, nil)
	response := httptest.NewRecorder()
	manager.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), png) {
		t.Fatalf("serve status=%d body=%d", response.Code, response.Body.Len())
	}
	if response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	if !strings.Contains(response.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("missing cache header")
	}
}

func TestRejectsUnsafeNamesAndTraversal(t *testing.T) {
	manager := testManager(t)
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	asset, err := manager.Save("ws_test", "../../escape.png", png)
	if err != nil {
		t.Fatalf("save sanitized name: %v", err)
	}
	if strings.Contains(asset.RelativePath, "..") {
		t.Fatalf("stored path escaped the assets root: %s", asset.RelativePath)
	}
	if _, err := manager.Resolve("ws_test", "../../../etc/passwd"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
	if _, err := manager.Save("ws_test", "fake.png", []byte("not a png")); err == nil {
		t.Fatal("expected invalid image bytes to be rejected")
	}
}

func TestCopyTo(t *testing.T) {
	manager := testManager(t)
	asset, err := manager.Save("ws_test", "note.txt", []byte("attachment body"))
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "copy.txt")
	if err := manager.CopyTo("ws_test", asset.RelativePath, dest); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, _ := io.ReadAll(file)
	if string(data) != "attachment body" {
		t.Fatalf("copy contents: %q", data)
	}
}
