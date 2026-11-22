package store

import (
	"encoding/json"
	"fmt"

	"noteral/internal/blocknote"
)

func seedWelcomePage(ws *WorkspaceDB) error {
	doc := welcomeDocument()
	analysis, err := blocknote.Analyze(doc)
	if err != nil {
		return err
	}
	now := nowString()
	id := "pg_welcome"
	_, err = ws.DB.Exec(`INSERT INTO pages(id,parent_id,title,icon,position,doc_json,text_content,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		id, "", "Welcome to Noteral", "", 1024, doc, analysis.Text, 1, now, now)
	if err != nil {
		return fmt.Errorf("seed welcome page: %w", err)
	}
	ui := `{"tabs":["` + id + `"],"activePageId":"` + id + `"}`
	_, _ = ws.DB.Exec(`INSERT INTO workspace_settings(key,value) VALUES('ui',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, ui)
	_, _ = ws.DB.Exec(`INSERT INTO recent(page_id,opened_at) VALUES(?,?)`, id, now)
	return nil
}

func inline(parts ...any) []any {
	out := make([]any, 0, len(parts))
	for _, p := range parts {
		switch v := p.(type) {
		case string:
			out = append(out, map[string]any{"type": "text", "text": v, "styles": map[string]any{}})
		case map[string]any:
			out = append(out, v)
		}
	}
	return out
}

func styled(text string, styles map[string]any) map[string]any {
	return map[string]any{"type": "text", "text": text, "styles": styles}
}

func link(text, href string) map[string]any {
	return map[string]any{"type": "link", "href": href, "content": inline(text)}
}

func baseProps() map[string]any {
	return map[string]any{"textAlignment": "left", "backgroundColor": "default", "textColor": "default"}
}

func paragraph(content []any) map[string]any {
	return map[string]any{"id": blocknote.NewBlockID(), "type": "paragraph", "props": baseProps(), "content": content, "children": []any{}}
}

func heading(level int, text string) map[string]any {
	p := baseProps()
	p["level"] = level
	p["isToggleable"] = false
	return map[string]any{"id": blocknote.NewBlockID(), "type": "heading", "props": p, "content": inline(text), "children": []any{}}
}

func listItem(kind, text string, checked bool) map[string]any {
	p := baseProps()
	if kind == "checkListItem" {
		p["checked"] = checked
	}
	return map[string]any{"id": blocknote.NewBlockID(), "type": kind, "props": p, "content": inline(text), "children": []any{}}
}

func welcomeDocument() string {
	blocks := []any{
		paragraph(inline("Noteral is a quiet, local-first place to write. Everything you create stays in a portable ",
			styled("Data/", map[string]any{"code": true}),
			" folder beside the app — no account, no syncing, no telemetry.")),
		heading(2, "A calmer place to think"),
		paragraph(inline("Use the sidebar to keep pages nested and ordered. Drag pages to rearrange them, double-click a title to rename it, and open as many tabs as you need.")),
		listItem("bulletListItem", "Type / on an empty line for headings, lists, tables, code and more.", false),
		listItem("bulletListItem", "Paste or drop an image or file to copy it into this workspace.", false),
		listItem("bulletListItem", "Press Ctrl/Cmd+K to search every page in the workspace.", false),
		heading(2, "Everything stays on this machine"),
		paragraph(inline("Notes are stored as BlockNote JSON in SQLite, with derived text indexes for search and backlinks. Saves are confirmed before the status bar says Saved.")),
		listItem("checkListItem", "Open the command palette with Ctrl/Cmd+K", false),
		listItem("checkListItem", "Turn on the right-hand inspector for outline and backlinks", false),
		listItem("checkListItem", "Write the first thing that comes to mind", false),
		map[string]any{
			"id":    blocknote.NewBlockID(),
			"type":  "quote",
			"props": baseProps(),
			"content": inline("The tool should disappear while you think. ",
				styled("Noteral tries to stay out of the way.", map[string]any{"italic": true})),
			"children": []any{},
		},
		map[string]any{
			"id":       blocknote.NewBlockID(),
			"type":     "codeBlock",
			"props":    map[string]any{"language": "sql", "textAlignment": "left", "backgroundColor": "default", "textColor": "default"},
			"content":  inline("SELECT title, snippet(pages_fts, 1, '[', ']', '…', 12)\nFROM pages_fts\nWHERE pages_fts MATCH 'local*';"),
			"children": []any{},
		},
		paragraph(inline("This page is yours to edit or delete. ",
			link("Wails", "https://v3.wails.io/"),
			" and ",
			link("BlockNote", "https://www.blocknotejs.org/"),
			" power the desktop shell and the editor.")),
	}
	b, _ := json.MarshalIndent(blocks, "", "  ")
	return string(b)
}
