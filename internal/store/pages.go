package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"noteral/internal/blocknote"
)

const maxDocBytes = 32 << 20

// PageMetaByID returns a single page's metadata.
func (s *Store) PageMetaByID(workspaceID, pageID string) (PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return PageMeta{}, err
	}
	return pageMetaByID(ws.DB, pageID)
}

func pageMetaByID(db *sql.DB, pageID string) (PageMeta, error) {
	var p PageMeta
	err := db.QueryRow(`SELECT id,parent_id,title,icon,position,updated_at FROM pages WHERE id=? AND deleted_at IS NULL`, pageID).
		Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Position, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PageMeta{}, fmt.Errorf("page not found")
	}
	return p, err
}

// ListPages returns all non-deleted page metadata, shallowest/position order.
func (s *Store) ListPages(workspaceID string) ([]PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	return listPages(ws.DB)
}

func listPages(db *sql.DB) ([]PageMeta, error) {
	rows, err := db.Query(`SELECT id,parent_id,title,icon,position,updated_at FROM pages WHERE deleted_at IS NULL ORDER BY position ASC, title COLLATE NOCASE ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PageMeta
	for rows.Next() {
		var p PageMeta
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Position, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Snapshot returns the shell state for a workspace.
func (s *Store) Snapshot(workspaceID string) (WorkspaceSnapshot, error) {
	ws, w, err := s.SwitchWorkspace(workspaceID)
	if err != nil {
		return WorkspaceSnapshot{}, err
	}
	pages, err := listPages(ws.DB)
	if err != nil {
		return WorkspaceSnapshot{}, err
	}
	favorites, _ := listFavorites(ws.DB)
	recent, _ := listRecent(ws.DB)
	ui, _ := loadUISettings(ws.DB)
	w.PageCount = len(pages)
	return WorkspaceSnapshot{Workspace: w, Pages: pages, Favorites: favorites, Recent: recent, Tabs: ui.Tabs, ActivePageID: ui.ActivePageID}, nil
}

// OpenPage loads a full body, hydrating asset URLs for the webview, and records
// the page in recents.
func (s *Store) OpenPage(workspaceID, pageID string) (PageDocument, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return PageDocument{}, err
	}
	d, err := loadPage(ws.DB, pageID, true, workspaceID)
	if err != nil {
		return PageDocument{}, err
	}
	now := nowString()
	_, _ = ws.DB.Exec(`INSERT INTO recent(page_id,opened_at) VALUES(?,?) ON CONFLICT(page_id) DO UPDATE SET opened_at=excluded.opened_at`, pageID, now)
	_, _ = ws.DB.Exec(`DELETE FROM recent WHERE page_id NOT IN (SELECT page_id FROM recent ORDER BY opened_at DESC LIMIT 15)`)
	return d, nil
}

// LoadPageForExport loads a page without changing recents and without hydrating
// asset paths. It is used by JSON/Markdown export.
func (s *Store) LoadPageForExport(workspaceID, pageID string) (PageDocument, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return PageDocument{}, err
	}
	return loadPage(ws.DB, pageID, false, workspaceID)
}

func loadPage(db *sql.DB, pageID string, hydrate bool, workspaceID string) (PageDocument, error) {
	var d PageDocument
	err := db.QueryRow(`SELECT id,parent_id,title,icon,position,updated_at,doc_json,revision,created_at FROM pages WHERE id=? AND deleted_at IS NULL`, pageID).
		Scan(&d.ID, &d.ParentID, &d.Title, &d.Icon, &d.Position, &d.UpdatedAt, &d.DocJSON, &d.Revision, &d.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PageDocument{}, fmt.Errorf("page not found")
	}
	if err != nil {
		return PageDocument{}, err
	}
	if hydrate {
		d.DocJSON = hydrateAssetURLs(d.DocJSON, workspaceID)
	}
	return d, nil
}

// SavePage commits a document with optimistic concurrency and transactional
// search/backlink indexing. It never reports success before the commit exists.
func (s *Store) SavePage(workspaceID, pageID, docJSON string, expectedRevision int64) (SaveResult, error) {
	if len(docJSON) > maxDocBytes {
		return SaveResult{}, fmt.Errorf("note is too large")
	}
	normalized := normalizeAssetURLs(docJSON, workspaceID)
	analysis, err := blocknote.Analyze(normalized)
	if err != nil {
		return SaveResult{}, err
	}
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return SaveResult{}, err
	}
	tx, err := ws.DB.Begin()
	if err != nil {
		return SaveResult{}, err
	}
	defer tx.Rollback()
	var current int64
	err = tx.QueryRow(`SELECT revision FROM pages WHERE id=? AND deleted_at IS NULL`, pageID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return SaveResult{}, fmt.Errorf("page not found")
	}
	if err != nil {
		return SaveResult{}, err
	}
	if expectedRevision > 0 && current != expectedRevision {
		return SaveResult{}, &ConflictError{Expected: expectedRevision, Current: current}
	}
	now := nowString()
	newRevision := current + 1
	_, err = tx.Exec(`UPDATE pages SET doc_json=?, text_content=?, revision=?, updated_at=? WHERE id=? AND deleted_at IS NULL`,
		normalized, analysis.Text, newRevision, now, pageID)
	if err != nil {
		return SaveResult{}, err
	}
	if _, err := tx.Exec(`DELETE FROM page_links WHERE source_page_id=?`, pageID); err != nil {
		return SaveResult{}, err
	}
	for _, target := range analysis.Backlinks {
		if target == pageID {
			continue
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO page_links(source_page_id,target_page_id,created_at) VALUES(?,?,?)`, pageID, target, now); err != nil {
			return SaveResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return SaveResult{}, err
	}
	return SaveResult{Revision: newRevision, UpdatedAt: now, WordCount: analysis.WordCount, BlockCount: analysis.BlockCount}, nil
}

// RenamePage changes only title metadata; the body revision is untouched so a
// rename from the sidebar cannot conflict with an open editor.
func (s *Store) RenamePage(workspaceID, pageID, title string) (PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return PageMeta{}, err
	}
	title = cleanTitle(title)
	res, err := ws.DB.Exec(`UPDATE pages SET title=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, title, nowString(), pageID)
	if err != nil {
		return PageMeta{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return PageMeta{}, fmt.Errorf("page not found")
	}
	return pageMetaByID(ws.DB, pageID)
}

// CreatePage creates an empty child page and returns its body.
func (s *Store) CreatePage(workspaceID, parentID string) (PageDocument, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return PageDocument{}, err
	}
	if parentID != "" {
		if _, err := pageMetaByID(ws.DB, parentID); err != nil {
			return PageDocument{}, fmt.Errorf("parent page not found")
		}
	}
	now := nowString()
	id := "pg_" + randomHex(8)
	var maxPos float64
	_ = ws.DB.QueryRow(`SELECT COALESCE(MAX(position),0) FROM pages WHERE parent_id=? AND deleted_at IS NULL`, parentID).Scan(&maxPos)
	doc := emptyDocument()
	_, err = ws.DB.Exec(`INSERT INTO pages(id,parent_id,title,icon,position,doc_json,text_content,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		id, parentID, "Untitled", "", maxPos+1024, doc, "", 1, now, now)
	if err != nil {
		return PageDocument{}, err
	}
	_, _ = ws.DB.Exec(`INSERT INTO recent(page_id,opened_at) VALUES(?,?) ON CONFLICT(page_id) DO UPDATE SET opened_at=excluded.opened_at`, id, now)
	return PageDocument{PageMeta: PageMeta{ID: id, ParentID: parentID, Title: "Untitled", Position: maxPos + 1024, UpdatedAt: now}, DocJSON: hydrateAssetURLs(doc, workspaceID), Revision: 1, CreatedAt: now}, nil
}

// DeletePage removes a page permanently, reparenting its children, cleaning up
// links/tabs/favorites and renumbering siblings. Daily backups provide recovery.
func (s *Store) DeletePage(workspaceID, pageID string) error {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return err
	}
	tx, err := ws.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var parentID string
	var position float64
	if err := tx.QueryRow(`SELECT parent_id,position FROM pages WHERE id=? AND deleted_at IS NULL`, pageID).Scan(&parentID, &position); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("page not found")
		}
		return err
	}
	if _, err := tx.Exec(`UPDATE pages SET parent_id=?, updated_at=? WHERE parent_id=? AND deleted_at IS NULL`, parentID, nowString(), pageID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM pages WHERE id=?`, pageID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM page_links WHERE source_page_id=? OR target_page_id=?`, pageID, pageID); err != nil {
		return err
	}
	for _, stmt := range []string{
		`DELETE FROM favorites WHERE page_id=?`,
		`DELETE FROM recent WHERE page_id=?`,
		`DELETE FROM tabs WHERE page_id=?`,
	} {
		if _, err := tx.Exec(stmt, pageID); err != nil {
			return err
		}
	}
	if err := renumberSiblings(tx, parentID); err != nil {
		return err
	}
	// Remove page IDs from the persisted tab list.
	if err := removeFromTabs(tx, pageID); err != nil {
		return err
	}
	return tx.Commit()
}

// MovePage reparents and/or reorders a page. beforeID is the sibling to insert
// before; empty means append. The tree is returned so the UI can reconcile.
func (s *Store) MovePage(workspaceID, pageID, newParentID, beforeID string) ([]PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if pageID == newParentID {
		return nil, fmt.Errorf("a page cannot contain itself")
	}
	if newParentID != "" {
		if _, err := pageMetaByID(ws.DB, newParentID); err != nil {
			return nil, fmt.Errorf("target page not found")
		}
	}
	tx, err := ws.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var oldParent string
	if err := tx.QueryRow(`SELECT parent_id FROM pages WHERE id=? AND deleted_at IS NULL`, pageID).Scan(&oldParent); err != nil {
		return nil, fmt.Errorf("page not found")
	}
	// Refuse cycles by walking up from the target parent.
	if newParentID != "" {
		cur := newParentID
		for depth := 0; depth < 10000 && cur != ""; depth++ {
			if cur == pageID {
				return nil, fmt.Errorf("a page cannot be moved inside itself")
			}
			if err := tx.QueryRow(`SELECT parent_id FROM pages WHERE id=?`, cur).Scan(&cur); err != nil {
				return nil, err
			}
		}
	}
	if _, err := tx.Exec(`UPDATE pages SET parent_id=?, updated_at=? WHERE id=?`, newParentID, nowString(), pageID); err != nil {
		return nil, err
	}
	// Renumber target siblings in the requested order.
	rows, err := tx.Query(`SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL AND id<>? ORDER BY position,title COLLATE NOCASE`, newParentID, pageID)
	if err != nil {
		return nil, err
	}
	var siblings []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		siblings = append(siblings, id)
	}
	rows.Close()
	insertAt := len(siblings)
	if beforeID != "" {
		for i, id := range siblings {
			if id == beforeID {
				insertAt = i
				break
			}
		}
	}
	siblings = append(siblings[:insertAt], append([]string{pageID}, siblings[insertAt:]...)...)
	for i, id := range siblings {
		if _, err := tx.Exec(`UPDATE pages SET position=? WHERE id=?`, float64(i+1)*1024, id); err != nil {
			return nil, err
		}
	}
	if oldParent != newParentID {
		if err := renumberSiblings(tx, oldParent); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return listPages(ws.DB)
}

func renumberSiblings(tx *sql.Tx, parentID string) error {
	rows, err := tx.Query(`SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL ORDER BY position,title COLLATE NOCASE`, parentID)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE pages SET position=? WHERE id=?`, float64(i+1)*1024, id); err != nil {
			return err
		}
	}
	return nil
}

// ToggleFavorite returns the new favorite state.
func (s *Store) ToggleFavorite(workspaceID, pageID string) (bool, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return false, err
	}
	if _, err := pageMetaByID(ws.DB, pageID); err != nil {
		return false, err
	}
	var n int
	_ = ws.DB.QueryRow(`SELECT COUNT(*) FROM favorites WHERE page_id=?`, pageID).Scan(&n)
	if n > 0 {
		_, err = ws.DB.Exec(`DELETE FROM favorites WHERE page_id=?`, pageID)
		return false, err
	}
	_, err = ws.DB.Exec(`INSERT INTO favorites(page_id,created_at) VALUES(?,?)`, pageID, nowString())
	return true, err
}

func listFavorites(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT f.page_id FROM favorites f JOIN pages p ON p.id=f.page_id WHERE p.deleted_at IS NULL ORDER BY f.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func listRecent(db *sql.DB) ([]PageMeta, error) {
	rows, err := db.Query(`SELECT p.id,p.parent_id,p.title,p.icon,p.position,p.updated_at FROM recent r JOIN pages p ON p.id=r.page_id WHERE p.deleted_at IS NULL ORDER BY r.opened_at DESC LIMIT 12`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PageMeta
	for rows.Next() {
		var p PageMeta
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Position, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetRecent returns recent metadata.
func (s *Store) GetRecent(workspaceID string) ([]PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	return listRecent(ws.DB)
}

// GetFavorites returns favorite page IDs.
func (s *Store) GetFavorites(workspaceID string) ([]string, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	return listFavorites(ws.DB)
}

// GetBacklinks returns pages that link to pageID.
func (s *Store) GetBacklinks(workspaceID, pageID string) ([]PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := ws.DB.Query(`SELECT p.id,p.parent_id,p.title,p.icon,p.position,p.updated_at
		FROM page_links l JOIN pages p ON p.id=l.source_page_id
		WHERE l.target_page_id=? AND p.deleted_at IS NULL AND p.id<>?
		ORDER BY p.updated_at DESC LIMIT 100`, pageID, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PageMeta
	for rows.Next() {
		var p PageMeta
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Position, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SaveUITabs persists open tabs and the active page for a workspace.
func (s *Store) SaveUITabs(workspaceID string, tabs []string, active string) error {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return err
	}
	valid := map[string]bool{}
	rows, err := ws.DB.Query(`SELECT id FROM pages WHERE deleted_at IS NULL`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		valid[id] = true
	}
	rows.Close()
	seen := map[string]bool{}
	clean := make([]string, 0, len(tabs))
	for _, id := range tabs {
		if valid[id] && !seen[id] && len(clean) < 50 {
			clean = append(clean, id)
			seen[id] = true
		}
	}
	if !valid[active] {
		active = ""
	}
	if active == "" && len(clean) > 0 {
		active = clean[0]
	}
	raw, _ := json.Marshal(UISettings{Tabs: clean, ActivePageID: active})
	_, err = ws.DB.Exec(`INSERT INTO workspace_settings(key,value) VALUES('ui',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
	return err
}

func loadUISettings(db *sql.DB) (UISettings, error) {
	var raw string
	if err := db.QueryRow(`SELECT value FROM workspace_settings WHERE key='ui'`).Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return UISettings{Tabs: []string{}}, nil
		}
		return UISettings{Tabs: []string{}}, err
	}
	var ui UISettings
	if err := json.Unmarshal([]byte(raw), &ui); err != nil {
		return UISettings{Tabs: []string{}}, nil
	}
	if ui.Tabs == nil {
		ui.Tabs = []string{}
	}
	return ui, nil
}

func removeFromTabs(tx *sql.Tx, pageID string) error {
	var raw string
	if err := tx.QueryRow(`SELECT value FROM workspace_settings WHERE key='ui'`).Scan(&raw); err != nil {
		return nil
	}
	var ui UISettings
	if err := json.Unmarshal([]byte(raw), &ui); err != nil {
		return nil
	}
	out := make([]string, 0, len(ui.Tabs))
	for _, id := range ui.Tabs {
		if id != pageID {
			out = append(out, id)
		}
	}
	if ui.ActivePageID == pageID {
		ui.ActivePageID = ""
		if len(out) > 0 {
			ui.ActivePageID = out[0]
		}
	}
	ui.Tabs = out
	b, _ := json.Marshal(ui)
	_, err := tx.Exec(`UPDATE workspace_settings SET value=? WHERE key='ui'`, string(b))
	return err
}

// PageTitles returns a resolver map for all live pages.
func (s *Store) PageTitles(workspaceID string) (map[string]string, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := ws.DB.Query(`SELECT id,title FROM pages WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err == nil {
			out[id] = title
		}
	}
	return out, rows.Err()
}

// BuildMarkdown renders a page body with live page-link titles.
func (s *Store) BuildMarkdown(workspaceID, pageID string, assetURL func(string) string) (string, int64, error) {
	doc, err := s.LoadPageForExport(workspaceID, pageID)
	if err != nil {
		return "", 0, err
	}
	titles, err := s.PageTitles(workspaceID)
	if err != nil {
		return "", 0, err
	}
	md, err := blocknote.RenderMarkdown(doc.DocJSON, blocknote.RenderOptions{
		Title: doc.Title,
		ResolvePageTitle: func(id string) string {
			if t, ok := titles[id]; ok {
				return t
			}
			return "Missing page"
		},
		AssetURL: assetURL,
	})
	if err != nil {
		return "", 0, err
	}
	return md, doc.Revision, nil
}

// PageChildren returns direct children, used by export and tests.
func (s *Store) PageChildren(workspaceID, pageID string) ([]PageMeta, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := ws.DB.Query(`SELECT id,parent_id,title,icon,position,updated_at FROM pages WHERE parent_id=? AND deleted_at IS NULL ORDER BY position`, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PageMeta
	for rows.Next() {
		var p PageMeta
		if err := rows.Scan(&p.ID, &p.ParentID, &p.Title, &p.Icon, &p.Position, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func hydrateAssetURLs(raw, workspaceID string) string {
	v, err := decodeAny(raw)
	if err != nil {
		return raw
	}
	prefix := "/__assets/" + workspaceID + "/"
	var walk func(any)
	walk = func(x any) {
		switch m := x.(type) {
		case map[string]any:
			if u, ok := m["url"].(string); ok && u != "" && !strings.HasPrefix(u, "/") && !strings.HasPrefix(u, "http") && !strings.HasPrefix(u, "data:") && !strings.HasPrefix(u, "blob:") {
				m["url"] = prefix + strings.TrimPrefix(u, "/")
			}
			for _, v := range m {
				walk(v)
			}
		case []any:
			for _, v := range m {
				walk(v)
			}
		}
	}
	walk(v)
	b, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return string(b)
}

func normalizeAssetURLs(raw, workspaceID string) string {
	prefix := "/__assets/" + workspaceID + "/"
	raw = strings.ReplaceAll(raw, prefix, "")
	return raw
}

func decodeAny(raw string) (any, error) {
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return nil, err
	}
	return v, nil
}
