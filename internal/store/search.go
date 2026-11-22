package store

import (
	"fmt"
	"strings"
	"unicode"
)

const (
	snipStart = "\uE000"
	snipEnd   = "\uE001"
)

// Search queries the FTS5 index. If FTS is unavailable at runtime it falls
// back to a bounded LIKE scan so search still works.
func (s *Store) Search(workspaceID, query string, limit int) ([]SearchHit, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	match := ftsMatchQuery(query)
	if match == "" {
		return []SearchHit{}, nil
	}
	rows, err := ws.DB.Query(`SELECT p.id,p.title,snippet(pages_fts,1,?,?,'…',24),p.updated_at
		FROM pages_fts JOIN pages p ON p.seq=pages_fts.rowid
		WHERE pages_fts MATCH ? AND p.deleted_at IS NULL
		ORDER BY bm25(pages_fts,8.0,1.0), p.updated_at DESC LIMIT ?`, snipStart, snipEnd, match, limit)
	if err == nil {
		defer rows.Close()
		var out []SearchHit
		for rows.Next() {
			var h SearchHit
			if err := rows.Scan(&h.PageID, &h.Title, &h.Snippet, &h.UpdatedAt); err != nil {
				return nil, err
			}
			out = append(out, h)
		}
		if err := rows.Err(); err == nil {
			if out == nil {
				out = []SearchHit{}
			}
			return out, nil
		}
	}
	return s.searchFallback(ws, query, limit)
}

func (s *Store) searchFallback(ws *WorkspaceDB, query string, limit int) ([]SearchHit, error) {
	like := "%" + query + "%"
	rows, err := ws.DB.Query(`SELECT id,title,text_content,updated_at FROM pages
		WHERE deleted_at IS NULL AND (title LIKE ? COLLATE NOCASE OR text_content LIKE ? COLLATE NOCASE)
		ORDER BY updated_at DESC LIMIT ?`, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SearchHit
	for rows.Next() {
		var id, title, text, updated string
		if err := rows.Scan(&id, &title, &text, &updated); err != nil {
			return nil, err
		}
		out = append(out, SearchHit{PageID: id, Title: title, Snippet: makeSnippet(text, query), UpdatedAt: updated})
	}
	if out == nil {
		out = []SearchHit{}
	}
	return out, rows.Err()
}

func makeSnippet(text, query string) string {
	if text == "" {
		return ""
	}
	lower := strings.ToLower(text)
	q := strings.ToLower(query)
	idx := strings.Index(lower, q)
	if idx < 0 {
		r := []rune(text)
		if len(r) > 180 {
			r = r[:180]
		}
		return string(r)
	}
	start := idx - 60
	if start < 0 {
		start = 0
	}
	end := idx + len(q) + 100
	if end > len(text) {
		end = len(text)
	}
	// Ensure rune boundaries.
	for start > 0 && !isRuneBoundary(text[start]) {
		start--
	}
	for end < len(text) && !isRuneBoundary(text[end]) {
		end++
	}
	pre := ""
	if start > 0 {
		pre = "…"
	}
	post := ""
	if end < len(text) {
		post = "…"
	}
	return pre + text[start:idx] + snipStart + text[idx:idx+len(q)] + snipEnd + text[idx+len(q):end] + post
}

func isRuneBoundary(b byte) bool { return b&0xC0 != 0x80 }

// ftsMatchQuery turns arbitrary user text into safe FTS5 prefix terms.
func ftsMatchQuery(query string) string {
	var terms []string
	var b strings.Builder
	flush := func() {
		if b.Len() == 0 {
			return
		}
		t := b.String()
		b.Reset()
		if len([]rune(t)) < 1 {
			return
		}
		terms = append(terms, `"`+strings.ReplaceAll(t, `"`, `""`)+`"*`)
	}
	for _, r := range query {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' {
			b.WriteRune(r)
		} else {
			flush()
		}
		if len(terms) >= 8 {
			break
		}
	}
	flush()
	if len(terms) > 8 {
		terms = terms[:8]
	}
	return strings.Join(terms, " ")
}

// SearchStatus is used by diagnostics/tests to confirm the index is usable.
func (s *Store) SearchStatus(workspaceID string) error {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return err
	}
	var n int
	if err := ws.DB.QueryRow(`SELECT COUNT(*) FROM pages_fts`).Scan(&n); err != nil {
		return fmt.Errorf("full-text index unavailable: %w", err)
	}
	return nil
}
