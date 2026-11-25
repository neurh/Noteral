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

func TestCreateItemsBatch(t *testing.T) {
	st, _ := openTestStore(t)
	const ws = "ws_default"
	if _, err := st.Snapshot(ws); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	db, err := st.CreateItem(ws, "", KindDatabase, "Tasks", `{"titleName":"Task","properties":[]}`)
	if err != nil {
		t.Fatalf("create database: %v", err)
	}
	first, err := st.CreateItem(ws, db.ID, KindPage, "Existing", "")
	if err != nil {
		t.Fatalf("create row: %v", err)
	}
	rows, err := st.CreateItems(ws, db.ID, KindPage, []NewItem{{Title: "A", Data: `{"p":1}`}, {Title: ""}, {Title: "C"}})
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if len(rows) != 3 || rows[0].Title != "A" || rows[1].Title != "Untitled" || rows[2].Data != "" {
		t.Fatalf("unexpected rows: %+v", rows)
	}
	if !(first.Position < rows[0].Position && rows[0].Position < rows[1].Position && rows[1].Position < rows[2].Position) {
		t.Fatalf("rows out of order")
	}
	if _, err := st.CreateItems(ws, db.ID, KindPage, []NewItem{{Title: "ok"}, {Data: "{bad"}}); err == nil {
		t.Fatalf("invalid data accepted")
	}
	if _, err := st.CreateItems(ws, "pg_missing", KindPage, []NewItem{{Title: "x"}}); err == nil {
		t.Fatalf("missing parent accepted")
	}
	snap, err := st.Snapshot(ws)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	count := 0
	for _, page := range snap.Pages {
		if page.ParentID == db.ID {
			count++
		}
	}
	if count != 4 {
		t.Fatalf("want 4 rows (failed batch must not leave partial rows), got %d", count)
	}
}
