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

func TestBacklinksFavoritesTabsAndDelete(t *testing.T) {
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
	if err := st.SaveUITabs("ws_default", []string{"pg_welcome", child.ID, "pg_missing"}, child.ID); err != nil {
		t.Fatalf("save tabs: %v", err)
	}
	snap, err := st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Tabs) != 2 || snap.ActivePageID != child.ID {
		t.Fatalf("unexpected tabs: %#v active=%s", snap.Tabs, snap.ActivePageID)
	}
	if err := st.DeletePage("ws_default", child.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	snap, err = st.Snapshot("ws_default")
	if err != nil {
		t.Fatalf("snapshot after delete: %v", err)
	}
	for _, id := range snap.Tabs {
		if id == child.ID {
			t.Fatal("deleted page remains in tabs")
		}
	}
	for _, id := range snap.Favorites {
		if id == child.ID {
			t.Fatal("deleted page remains a favorite")
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
