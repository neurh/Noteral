package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"noteral/internal/blocknote"
)

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func emptyDocument() string { return blocknote.EmptyDocument() }

func cleanWorkspaceName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Untitled Workspace"
	}
	if utf8.RuneCountInString(name) > 80 {
		r := []rune(name)
		name = string(r[:80])
	}
	return name
}

func cleanTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "Untitled"
	}
	if utf8.RuneCountInString(title) > 300 {
		r := []rune(title)
		title = string(r[:300])
	}
	return title
}

func jsonMarshal(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func jsonUnmarshal(raw string, v any) error { return json.Unmarshal([]byte(raw), v) }
