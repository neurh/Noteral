// Package blocknote contains the small, versioned server-side understanding of
// BlockNote's JSON document format: plain text indexing, backlinks, asset
// references, word counts and Markdown rendering. The JSON document itself is
// always stored untouched as the canonical source of truth.
package blocknote

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// Analysis is derived metadata from a document.
type Analysis struct {
	Text       string
	Backlinks  []string
	Assets     []string
	WordCount  int
	BlockCount int
}

// Parse decodes a BlockNote document array, rejecting malformed JSON.
func Parse(raw string) ([]any, error) {
	if strings.TrimSpace(raw) == "" {
		return []any{}, nil
	}
	var doc any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("invalid note document: %w", err)
	}
	switch v := doc.(type) {
	case []any:
		return v, nil
	case map[string]any:
		for _, key := range []string{"blocks", "document", "content"} {
			if arr, ok := v[key].([]any); ok {
				return arr, nil
			}
		}
	}
	return nil, fmt.Errorf("invalid note document: expected an array of blocks")
}

// Analyze extracts searchable text, page-link targets, asset references and
// statistics from a document.
func Analyze(raw string) (Analysis, error) {
	blocks, err := Parse(raw)
	if err != nil {
		return Analysis{}, err
	}
	var out Analysis
	links := map[string]struct{}{}
	assets := map[string]struct{}{}
	var text strings.Builder

	var walkBlock func(block map[string]any, depth int)
	var walkContent func(content any, depth int)

	walkContent = func(content any, depth int) {
		if depth > 80 {
			return
		}
		switch c := content.(type) {
		case string:
			text.WriteString(c)
		case []any:
			for _, item := range c {
				walkContent(item, depth)
			}
		case map[string]any:
			typ, _ := c["type"].(string)
			if t, ok := c["text"].(string); ok {
				text.WriteString(t)
			}
			if props, ok := c["props"].(map[string]any); ok {
				if typ == "pageLink" || typ == "noteralPageLink" {
					if id, ok := props["pageId"].(string); ok && id != "" {
						links[id] = struct{}{}
					}
				}
				if u, ok := props["url"].(string); ok {
					collectAsset(u, assets)
				}
				if href, ok := props["href"].(string); ok && strings.HasPrefix(href, "noteral-page://") {
					if id := strings.TrimPrefix(href, "noteral-page://"); id != "" {
						links[id] = struct{}{}
					}
				}
			}
			if href, ok := c["href"].(string); ok && strings.HasPrefix(href, "noteral-page://") {
				if id := strings.TrimPrefix(href, "noteral-page://"); id != "" {
					links[id] = struct{}{}
				}
			}
			if inner, ok := c["content"]; ok {
				walkContent(inner, depth+1)
			}
			if rows, ok := c["rows"].([]any); ok {
				walkTableRows(rows, walkContent)
			}
		}
	}

	walkBlock = func(block map[string]any, depth int) {
		if depth > 80 {
			return
		}
		out.BlockCount++
		typ, _ := block["type"].(string)
		if text.Len() > 0 {
			text.WriteByte('\n')
		}
		props, _ := block["props"].(map[string]any)
		if props != nil {
			if u, ok := props["url"].(string); ok {
				collectAsset(u, assets)
			}
			if typ == "pageLink" || typ == "noteralPageLink" {
				if id, ok := props["pageId"].(string); ok && id != "" {
					links[id] = struct{}{}
				}
			}
		}
		if typ != "divider" && typ != "pageBreak" {
			if content, ok := block["content"]; ok {
				walkContent(content, depth+1)
			}
		}
		if children, ok := block["children"].([]any); ok {
			for _, child := range children {
				if cm, ok := child.(map[string]any); ok {
					walkBlock(cm, depth+1)
				}
			}
		}
	}

	for _, item := range blocks {
		if block, ok := item.(map[string]any); ok {
			walkBlock(block, 0)
		}
	}

	out.Text = strings.TrimSpace(text.String())
	out.WordCount = CountWords(out.Text)
	out.Backlinks = sortedSet(links)
	out.Assets = sortedSet(assets)
	return out, nil
}

func walkTableRows(rows []any, walkContent func(any, int)) {
	for _, row := range rows {
		rm, ok := row.(map[string]any)
		if !ok {
			continue
		}
		cells, _ := rm["cells"].([]any)
		for _, cell := range cells {
			if ca, ok := cell.([]any); ok {
				walkContent(ca, 0)
			}
		}
	}
}

func sortedSet(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func collectAsset(u string, set map[string]struct{}) {
	u = strings.TrimSpace(u)
	if u == "" || strings.HasPrefix(u, "data:") || strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "blob:") {
		return
	}
	set[u] = struct{}{}
}

// CountWords counts human-readable words, treating CJK characters as one word
// each and Latin/digit runs as one word.
func CountWords(s string) int {
	count := 0
	inWord := false
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Han, r), unicode.Is(unicode.Hiragana, r), unicode.Is(unicode.Katakana, r), unicode.Is(unicode.Hangul, r):
			count++
			inWord = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if !inWord {
				count++
				inWord = true
			}
		default:
			inWord = false
		}
	}
	return count
}

// NewBlockID creates a stable block ID for server-created documents.
func NewBlockID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "blk_" + hex.EncodeToString(b[:])
}

// EmptyDocument returns a valid one-paragraph BlockNote document.
func EmptyDocument() string {
	id := NewBlockID()
	return fmt.Sprintf(`[{"id":%q,"type":"paragraph","props":{"textAlignment":"left","backgroundColor":"default","textColor":"default"},"content":[],"children":[]}]`, id)
}

// AssetsFromDocument returns the relative asset references in a document.
func AssetsFromDocument(raw string) ([]string, error) {
	a, err := Analyze(raw)
	if err != nil {
		return nil, err
	}
	return a.Assets, nil
}
