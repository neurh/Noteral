package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"noteral/internal/datadir"
)

func openTestStore(t *testing.T) (*Store, datadir.Info) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "Data")
	info, err := datadir.Resolve(root)
	if err != nil {
		t.Fatalf("resolve data dir: %v", err)
	}
	st, err := Open(info)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st, info
}

func TestFirstLaunchSeedsWelcomeExactlyOnce(t *testing.T) {
	st, info := openTestStore(t)
	ws, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if ws.Workspace.Name != "Default Workspace" || len(ws.Pages) != 1 {
		t.Fatalf("unexpected default workspace: %+v", ws)
	}
	if ws.Pages[0].ID != "pg_welcome" || ws.Pages[0].Title != "Welcome to Noteral" {
		t.Fatalf("unexpected seeded page: %+v", ws.Pages[0])
	}
	if len(ws.Tabs) != 1 || ws.Tabs[0] != "pg_welcome" {
		t.Fatalf("unexpected tabs: %#v", ws.Tabs)
	}
	if st.LastWorkspaceID() != "ws_default" {
		t.Fatalf("last workspace = %q", st.LastWorkspaceID())
	}
	_ = st.Close()

	st2, err := Open(info)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = st2.Close() })
	ws2, err := st2.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot after reopen: %v", err)
	}
	if len(ws2.Pages) != 1 {
		t.Fatalf("welcome should not be re-seeded, pages=%d", len(ws2.Pages))
	}
	var initialized, seeded string
	_ = st2.appDB.QueryRow(`SELECT value FROM meta WHERE key='initialized'`).Scan(&initialized)
	_ = st2.appDB.QueryRow(`SELECT value FROM meta WHERE key='welcome_seeded'`).Scan(&seeded)
	if initialized != "1" || seeded != "1" {
		t.Fatalf("meta not persisted: initialized=%q seeded=%q", initialized, seeded)
	}
}

func TestSaveReopenConflictAndSearch(t *testing.T) {
	st, info := openTestStore(t)
	doc, err := st.OpenPage("ws_default", "pg_welcome")
	if err != nil {
		t.Fatalf("open page: %v", err)
	}
	modified := strings.Replace(doc.DocJSON, "A calmer place to think", "A unique zebra workspace", 1)
	if modified == doc.DocJSON {
		t.Fatal("failed to modify document")
	}
	res, err := st.SavePage("ws_default", "pg_welcome", modified, doc.Revision)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if res.Revision != 2 || res.WordCount == 0 {
		t.Fatalf("unexpected save result: %+v", res)
	}
	hits, err := st.Search("ws_default", "zebra", 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 || hits[0].PageID != "pg_welcome" {
		t.Fatalf("unexpected search hits: %+v", hits)
	}
	if _, err := st.SavePage("ws_default", "pg_welcome", modified, doc.Revision); err == nil {
		t.Fatal("expected a revision conflict")
	} else {
		var conflict *ConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("expected ConflictError, got %T: %v", err, err)
		}
	}
	_ = st.Close()

	st2, err := Open(info)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = st2.Close() })
	reopened, err := st2.OpenPage("ws_default", "pg_welcome")
	if err != nil {
		t.Fatalf("reopen page: %v", err)
	}
	if reopened.Revision != 2 || !strings.Contains(reopened.DocJSON, "zebra") {
		t.Fatalf("document did not persist: revision=%d", reopened.Revision)
	}
}

func TestHomeSettingsDefaults(t *testing.T) {
	got := normalizeHomeSettings(HomeTabSettings{Template: "neon", Background: "chartreuse"})
	if got.Template != "default" || got.Background != "paper" {
		t.Fatalf("unknown values should fall back to defaults: %+v", got)
	}
	got = normalizeHomeSettings(HomeTabSettings{Template: "focus", Background: "sage"})
	if got.Template != "focus" || got.Background != "sage" {
		t.Fatalf("supported values should survive: %+v", got)
	}
}

func TestHomeTabsPersist(t *testing.T) {
	st, _ := openTestStore(t)
	homeTabs := map[string]HomeTabSettings{
		"home:one":   {Template: "gallery", Background: "sage"},
		"home:two":   {Template: "focus", Background: "dusk"},
		"home:stale": {Template: "library", Background: "clay"},
	}
	if err := st.SaveUITabs("ws_default", []string{"home:one", "pg_welcome", "home:two", "home:one", "pg_missing"}, "home:two", homeTabs, ""); err != nil {
		t.Fatalf("save tabs: %v", err)
	}
	snap, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Tabs) != 3 || snap.Tabs[0] != "home:one" || snap.Tabs[1] != "pg_welcome" || snap.Tabs[2] != "home:two" {
		t.Fatalf("unexpected home tabs: %#v", snap.Tabs)
	}
	if snap.ActiveTabID != "home:two" || snap.ActivePageID != "" {
		t.Fatalf("unexpected active home tab: %q page=%q", snap.ActiveTabID, snap.ActivePageID)
	}
	if snap.HomeTabs["home:one"].Template != "gallery" || snap.HomeTabs["home:one"].Background != "sage" {
		t.Fatalf("unexpected home one settings: %+v", snap.HomeTabs["home:one"])
	}
	if _, ok := snap.HomeTabs["home:stale"]; ok {
		t.Fatal("stale home tab settings were persisted")
	}

	layout := `{"version":1,"root":{"type":"pane","id":"p1","tabs":["pg_welcome"],"activeTabId":"pg_welcome"},"focusedPaneId":"p1","maximizedPaneId":""}`
	if err := st.SaveUITabs("ws_default", snap.Tabs, "pg_welcome", snap.HomeTabs, layout); err != nil {
		t.Fatalf("save page tab: %v", err)
	}
	snap, _ = st.Snapshot("ws_default")
	if snap.ActiveTabID != "pg_welcome" || snap.ActivePageID != "pg_welcome" {
		t.Fatalf("unexpected active page tab: %q page=%q", snap.ActiveTabID, snap.ActivePageID)
	}
	if snap.Layout != layout {
		t.Fatalf("layout did not round-trip: %q", snap.Layout)
	}

	if err := st.SaveUITabs("ws_default", nil, "", nil, "{not json"); err != nil {
		t.Fatalf("save empty tabs: %v", err)
	}
	snap, _ = st.Snapshot("ws_default")
	if len(snap.Tabs) != 1 || !isHomeTabID(snap.Tabs[0]) || snap.ActiveTabID != snap.Tabs[0] || snap.ActivePageID != "" {
		t.Fatalf("empty tabs should rest on Home: %#v active=%q page=%q", snap.Tabs, snap.ActiveTabID, snap.ActivePageID)
	}
	if snap.Layout != "" {
		t.Fatalf("invalid layout was persisted: %q", snap.Layout)
	}
}

func TestBacklinksFavoritesTabsAndTrash(t *testing.T) {
	st, _ := openTestStore(t)
	child, err := st.CreatePage("ws_default", "")
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	linkDoc := `[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"pageLink","props":{"pageId":"pg_welcome"}}],"children":[]}]`
	if _, err := st.SavePage("ws_default", child.ID, linkDoc, child.Revision); err != nil {
		t.Fatalf("save link doc: %v", err)
	}
	backlinks, err := st.GetBacklinks("ws_default", "pg_welcome")
	if err != nil {
		t.Fatalf("backlinks: %v", err)
	}
	if len(backlinks) != 1 || backlinks[0].ID != child.ID {
		t.Fatalf("unexpected backlinks: %+v", backlinks)
	}
	favorite, err := st.ToggleFavorite("ws_default", child.ID)
	if err != nil || !favorite {
		t.Fatalf("favorite: %v %v", favorite, err)
	}
	if err := st.SaveUITabs("ws_default", []string{"pg_welcome", child.ID, "pg_missing"}, child.ID, nil, ""); err != nil {
		t.Fatalf("save tabs: %v", err)
	}
	snap, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Tabs) != 2 || snap.ActiveTabID != child.ID || snap.ActivePageID != child.ID {
		t.Fatalf("unexpected tabs: %#v activeTab=%s activePage=%s", snap.Tabs, snap.ActiveTabID, snap.ActivePageID)
	}
	if err := st.TrashPage("ws_default", child.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	snap, err = st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot after trash: %v", err)
	}
	for _, id := range snap.Tabs {
		if id == child.ID {
			t.Fatal("trashed page remains in tabs")
		}
	}
	for _, id := range snap.Favorites {
		if id == child.ID {
			t.Fatal("trashed page remains a favorite")
		}
	}
	if len(snap.Trash) != 1 || snap.Trash[0].ID != child.ID {
		t.Fatalf("unexpected trash: %+v", snap.Trash)
	}
	if _, err := st.OpenPage("ws_default", child.ID); err == nil {
		t.Fatal("trashed page is still readable")
	}
	if err := st.RestorePage("ws_default", child.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	snap, err = st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot after restore: %v", err)
	}
	if len(snap.Trash) != 0 {
		t.Fatalf("trash should be empty: %+v", snap.Trash)
	}
	if _, err := st.OpenPage("ws_default", child.ID); err != nil {
		t.Fatalf("restored page cannot be opened: %v", err)
	}
	if err := st.TrashPage("ws_default", child.ID); err != nil {
		t.Fatalf("trash again: %v", err)
	}
	if err := st.DeletePagePermanently("ws_default", child.ID); err != nil {
		t.Fatalf("delete permanently: %v", err)
	}
	if _, err := st.OpenPage("ws_default", child.ID); err == nil {
		t.Fatal("permanently deleted page is still readable")
	}
}

func TestTrashAndRestoreSubtree(t *testing.T) {
	st, _ := openTestStore(t)
	root, err := st.CreatePage("ws_default", "")
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	child, err := st.CreatePage("ws_default", root.ID)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	grandchild, err := st.CreatePage("ws_default", child.ID)
	if err != nil {
		t.Fatalf("create grandchild: %v", err)
	}
	if err := st.TrashPage("ws_default", root.ID); err != nil {
		t.Fatalf("trash root: %v", err)
	}
	snap, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Trash) != 1 || snap.Trash[0].ID != root.ID {
		t.Fatalf("trash should show only the root: %+v", snap.Trash)
	}
	for _, id := range []string{root.ID, child.ID, grandchild.ID} {
		if _, err := st.OpenPage("ws_default", id); err == nil {
			t.Fatalf("trashed page %s is still readable", id)
		}
	}
	if err := st.RestorePage("ws_default", root.ID); err != nil {
		t.Fatalf("restore root: %v", err)
	}
	snap, err = st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot after restore: %v", err)
	}
	if len(snap.Trash) != 0 {
		t.Fatalf("trash should be empty: %+v", snap.Trash)
	}
	for _, id := range []string{root.ID, child.ID, grandchild.ID} {
		if _, err := st.OpenPage("ws_default", id); err != nil {
			t.Fatalf("restored page %s cannot be opened: %v", id, err)
		}
	}
	restoredChild, err := st.PageMetaByID("ws_default", child.ID)
	if err != nil || restoredChild.ParentID != root.ID {
		t.Fatalf("child parent was not preserved: %+v %v", restoredChild, err)
	}
}

func TestRestoreReparentsWhenParentIsTrashed(t *testing.T) {
	st, _ := openTestStore(t)
	parent, _ := st.CreatePage("ws_default", "")
	child, _ := st.CreatePage("ws_default", parent.ID)
	if err := st.TrashPage("ws_default", child.ID); err != nil {
		t.Fatalf("trash child: %v", err)
	}
	if err := st.TrashPage("ws_default", parent.ID); err != nil {
		t.Fatalf("trash parent: %v", err)
	}
	if err := st.RestorePage("ws_default", child.ID); err != nil {
		t.Fatalf("restore child: %v", err)
	}
	restored, err := st.PageMetaByID("ws_default", child.ID)
	if err != nil {
		t.Fatalf("load restored child: %v", err)
	}
	if restored.ParentID != "" {
		t.Fatalf("restored child should become a root, parent=%q", restored.ParentID)
	}
	if snap, _ := st.Snapshot("ws_default"); len(snap.Trash) != 1 || snap.Trash[0].ID != parent.ID {
		t.Fatalf("parent should remain in trash: %+v", snap.Trash)
	}
}

func TestDuplicatePageCopiesSubtree(t *testing.T) {
	st, _ := openTestStore(t)
	root, err := st.CreatePage("ws_default", "")
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	child, err := st.CreatePage("ws_default", root.ID)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	rootDoc := `[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"root copy text","styles":{}},{"type":"pageLink","props":{"pageId":"pg_welcome"}}],"children":[]}]`
	if _, err := st.SavePage("ws_default", root.ID, rootDoc, root.Revision); err != nil {
		t.Fatalf("save root: %v", err)
	}
	childDoc := `[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"child copy text","styles":{}}],"children":[]}]`
	if _, err := st.SavePage("ws_default", child.ID, childDoc, child.Revision); err != nil {
		t.Fatalf("save child: %v", err)
	}
	copyID, err := st.DuplicatePage("ws_default", root.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	copyRoot, err := st.OpenPage("ws_default", copyID)
	if err != nil {
		t.Fatalf("open copy: %v", err)
	}
	if copyRoot.Title != "Copy of Untitled" || !strings.Contains(copyRoot.DocJSON, "root copy text") {
		t.Fatalf("unexpected copied root: title=%q doc=%s", copyRoot.Title, copyRoot.DocJSON)
	}
	children, err := st.PageChildren("ws_default", copyID)
	if err != nil || len(children) != 1 {
		t.Fatalf("copied children: %+v %v", children, err)
	}
	copyChild, err := st.OpenPage("ws_default", children[0].ID)
	if err != nil || !strings.Contains(copyChild.DocJSON, "child copy text") {
		t.Fatalf("copied child doc: %+v %v", copyChild, err)
	}
	backlinks, err := st.GetBacklinks("ws_default", "pg_welcome")
	if err != nil {
		t.Fatalf("backlinks: %v", err)
	}
	foundCopy := false
	for _, backlink := range backlinks {
		if backlink.ID == copyID {
			foundCopy = true
		}
	}
	if !foundCopy {
		t.Fatalf("copied page links were not indexed: %+v", backlinks)
	}
}

func TestPageAppearancePersistsAndCopies(t *testing.T) {
	st, _ := openTestStore(t)
	page, err := st.CreatePage("ws_default", "")
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	icon := "lucide:sparkles:#b1533d"
	cover := "image:wild-bloom"
	meta, err := st.SetPageAppearance("ws_default", page.ID, icon, cover)
	if err != nil {
		t.Fatalf("set appearance: %v", err)
	}
	if meta.Icon != icon || meta.Cover != cover {
		t.Fatalf("unexpected appearance: %+v", meta)
	}
	doc, err := st.OpenPage("ws_default", page.ID)
	if err != nil || doc.Icon != icon || doc.Cover != cover {
		t.Fatalf("appearance was not persisted: %+v %v", doc.PageMeta, err)
	}
	copyID, err := st.DuplicatePage("ws_default", page.ID)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	copied, err := st.OpenPage("ws_default", copyID)
	if err != nil || copied.Cover != cover || copied.Icon != icon {
		t.Fatalf("appearance was not copied: %+v %v", copied.PageMeta, err)
	}
	if err := st.TrashPage("ws_default", page.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	if err := st.RestorePage("ws_default", page.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	restored, err := st.OpenPage("ws_default", page.ID)
	if err != nil || restored.Cover != cover {
		t.Fatalf("appearance did not survive trash: %+v %v", restored.PageMeta, err)
	}
	if _, err := st.SetPageAppearance("ws_default", page.ID, "", strings.Repeat("x", maxAppearanceBytes+1)); err == nil {
		t.Fatal("oversized appearance should fail")
	}
	if _, err := st.SetPageAppearance("ws_default", page.ID, "bad\x00icon", ""); err == nil {
		t.Fatal("NUL in appearance should fail")
	}
}

func TestWorkspaceMigrationAddsCover(t *testing.T) {
	db, err := openDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("open workspace db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE pages (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatalf("create old pages table: %v", err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatalf("set old schema version: %v", err)
	}
	if err := migrateWorkspace(db); err != nil {
		t.Fatalf("migrate workspace: %v", err)
	}
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != schemaVersion {
		t.Fatalf("schema version = %d, %v", version, err)
	}
	if _, err := db.Exec(`INSERT INTO pages(id,cover) VALUES('pg_test','image:alpine-dawn')`); err != nil {
		t.Fatalf("insert cover: %v", err)
	}
	var cover string
	if err := db.QueryRow(`SELECT cover FROM pages WHERE id='pg_test'`).Scan(&cover); err != nil || cover != "image:alpine-dawn" {
		t.Fatalf("cover = %q, %v", cover, err)
	}
}

func TestEmptyTrash(t *testing.T) {
	st, _ := openTestStore(t)
	first, _ := st.CreatePage("ws_default", "")
	second, _ := st.CreatePage("ws_default", first.ID)
	if err := st.TrashPage("ws_default", first.ID); err != nil {
		t.Fatalf("trash: %v", err)
	}
	if err := st.EmptyTrash("ws_default"); err != nil {
		t.Fatalf("empty trash: %v", err)
	}
	snap, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Trash) != 0 {
		t.Fatalf("trash should be empty: %+v", snap.Trash)
	}
	for _, id := range []string{first.ID, second.ID} {
		if _, err := st.OpenPage("ws_default", id); err == nil {
			t.Fatalf("page %s survived empty trash", id)
		}
	}
}

func TestWorkspaceIsolationAndRename(t *testing.T) {
	st, _ := openTestStore(t)
	second, err := st.CreateWorkspace("Second Brain")
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	page, err := st.CreatePage(second.ID, "")
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	secretDoc := `[{"id":"b1","type":"paragraph","props":{},"content":[{"type":"text","text":"orchid secret","styles":{}}],"children":[]}]`
	saved, err := st.SavePage(second.ID, page.ID, secretDoc, page.Revision)
	if err != nil {
		t.Fatalf("save secret: %v", err)
	}
	if _, err := st.OpenPage("ws_default", page.ID); err == nil {
		t.Fatal("page leaked across workspaces")
	}
	hits, err := st.Search("ws_default", "orchid", 10)
	if err != nil {
		t.Fatalf("search default: %v", err)
	}
	if len(hits) != 0 {
		t.Fatalf("workspace isolation failed: %+v", hits)
	}
	renamed, err := st.RenamePage(second.ID, page.ID, "  Renamed  ")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Title != "Renamed" {
		t.Fatalf("title = %q", renamed.Title)
	}
	var revision int64
	_ = st.workspaces[second.ID].DB.QueryRow(`SELECT revision FROM pages WHERE id=?`, page.ID).Scan(&revision)
	if revision != saved.Revision {
		t.Fatalf("rename changed body revision: %d -> %d", saved.Revision, revision)
	}
}

func TestMovePreventsCycles(t *testing.T) {
	st, _ := openTestStore(t)
	parent, err := st.CreatePage("ws_default", "")
	if err != nil {
		t.Fatal(err)
	}
	child, err := st.CreatePage("ws_default", parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.MovePage("ws_default", parent.ID, child.ID, ""); err == nil {
		t.Fatal("expected cycle rejection")
	}
	moved, err := st.MovePage("ws_default", child.ID, "", "")
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	found := false
	for _, page := range moved {
		if page.ID == child.ID {
			found = true
			if page.ParentID != "" {
				t.Fatalf("child parent = %q", page.ParentID)
			}
		}
	}
	if !found {
		t.Fatal("moved child missing from list")
	}
}
