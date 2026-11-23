package store

import (
	"strings"
	"testing"
)

func TestFoldersAndDatabases(t *testing.T) {
	st, _ := openTestStore(t)
	const ws = "ws_default"
	if _, err := st.Snapshot(ws); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	folder, err := st.CreateItem(ws, "", KindFolder, "", "")
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if folder.Kind != KindFolder || folder.Title != "New folder" {
		t.Fatalf("unexpected folder: %+v", folder.PageMeta)
	}
	if _, err := st.CreateItem(ws, "", "spreadsheet", "", ""); err == nil {
		t.Fatalf("unknown kind accepted")
	}
	if _, err := st.CreateItem(ws, "", KindDatabase, "", "{nope"); err == nil {
		t.Fatalf("invalid JSON accepted")
	}
	schema := `{"titleName":"Task","properties":[{"id":"p_s","name":"Status","type":"select","options":[{"id":"o1","name":"Done"}]},{"id":"p_c","name":"Ok","type":"checkbox"}]}`
	db, err := st.CreateItem(ws, folder.ID, KindDatabase, "Tasks", schema)
	if err != nil {
		t.Fatalf("create database: %v", err)
	}
	row, err := st.CreateItem(ws, db.ID, KindPage, "Write | docs", `{"values":{"p_s":"o1"}}`)
	if err != nil {
		t.Fatalf("create row: %v", err)
	}
	meta, err := st.SetPageData(ws, row.ID, `{"values":{"p_s":"o1","p_c":true}}`)
	if err != nil || !strings.Contains(meta.Data, `"p_c":true`) || meta.Kind != KindPage || meta.CreatedAt == "" {
		t.Fatalf("set data: %+v %v", meta, err)
	}
	snap, err := st.Snapshot(ws)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	kinds := map[string]string{}
	for _, p := range snap.Pages {
		kinds[p.ID] = p.Kind
	}
	if kinds[folder.ID] != KindFolder || kinds[db.ID] != KindDatabase || kinds["pg_welcome"] != KindPage {
		t.Fatalf("kinds not listed: %#v", kinds)
	}
	md, _, err := st.BuildMarkdown(ws, db.ID, nil)
	if err != nil {
		t.Fatalf("markdown: %v", err)
	}
	if !strings.Contains(md, "| Task | Status | Ok |") || !strings.Contains(md, `| Write \| docs | Done | [x] |`) {
		t.Fatalf("unexpected markdown:\n%s", md)
	}

	// Duplicating a page that embeds its child database repoints the block.
	host, err := st.CreateItem(ws, "", KindPage, "Host", "")
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	inline, err := st.CreateItem(ws, host.ID, KindDatabase, "Inline", schema)
	if err != nil {
		t.Fatalf("create inline: %v", err)
	}
	doc := `[{"id":"b1","type":"database","props":{"databaseId":"` + inline.ID + `"},"children":[]}]`
	if _, err := st.SavePage(ws, host.ID, doc, 0); err != nil {
		t.Fatalf("save host: %v", err)
	}
	copyID, err := st.DuplicatePage(ws, host.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	children, _ := st.PageChildren(ws, copyID)
	if len(children) != 1 || children[0].Kind != KindDatabase || children[0].Data != schema {
		t.Fatalf("database not copied: %+v", children)
	}
	copied, err := st.OpenPage(ws, copyID)
	if err != nil {
		t.Fatalf("open copy: %v", err)
	}
	if !strings.Contains(copied.DocJSON, children[0].ID) || strings.Contains(copied.DocJSON, inline.ID) {
		t.Fatalf("inline database not remapped: %s", copied.DocJSON)
	}
}
