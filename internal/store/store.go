package store

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"noteral/internal/datadir"

	_ "modernc.org/sqlite"
)

const schemaVersion = 1

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,80}$`)

// Store owns the application registry plus lazily opened workspace databases.
type Store struct {
	info datadir.Info

	appMu sync.Mutex
	appDB *sql.DB

	mu         sync.Mutex
	workspaces map[string]*WorkspaceDB
	closed     bool

	backupMu sync.Mutex
}

// WorkspaceDB is one isolated workspace database. MaxOpenConns(1) serializes
// writes and makes delayed saves safe within a workspace.
type WorkspaceDB struct {
	DB *sql.DB
	ID string
}

// Open initializes the application registry and default workspace.
func Open(info datadir.Info) (*Store, error) {
	s := &Store{info: info, workspaces: map[string]*WorkspaceDB{}}
	db, err := openDB(info.AppDB)
	if err != nil {
		return nil, fmt.Errorf("open application database: %w", err)
	}
	s.appDB = db
	if err := s.migrateApp(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.ensureDefaultWorkspace(); err != nil {
		_ = db.Close()
		return nil, err
	}
	go s.BackupIfNeeded()
	return s, nil
}

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("%s: %w", p, err)
		}
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func (s *Store) migrateApp() error {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	var version int
	if err := s.appDB.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read application schema version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("Noteral's data was created by a newer version (schema %d, this build supports %d)", version, schemaVersion)
	}
	if version == 0 {
		tx, err := s.appDB.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS workspaces (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				last_opened_at TEXT NOT NULL DEFAULT '',
				position INTEGER NOT NULL DEFAULT 0
			)`,
			`CREATE TABLE IF NOT EXISTS app_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS plugin_state (
				id TEXT PRIMARY KEY,
				version TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 0,
				installed_at TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT ''
			)`,
			`CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
			`PRAGMA user_version = 1`,
		}
		for _, stmt := range stmts {
			if _, err := tx.Exec(stmt); err != nil {
				return fmt.Errorf("initialize application database: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ensureDefaultWorkspace() error {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	var count int
	if err := s.appDB.QueryRow(`SELECT COUNT(*) FROM workspaces`).Scan(&count); err != nil {
		return fmt.Errorf("count workspaces: %w", err)
	}
	if count > 0 {
		return nil
	}
	now := nowString()
	id := "ws_default"
	_, err := s.appDB.Exec(`INSERT INTO workspaces(id,name,created_at,updated_at,last_opened_at,position) VALUES(?,?,?,?,?,0)`, id, "Default Workspace", now, now, now)
	if err != nil {
		return fmt.Errorf("create default workspace: %w", err)
	}
	if _, err := s.openWorkspaceLocked(id, true); err != nil {
		return fmt.Errorf("create default workspace: %w", err)
	}
	if err := s.setMetaLocked("initialized", "1"); err != nil {
		return err
	}
	_ = s.setMetaLocked("welcome_seeded", "1")
	_ = s.setLastWorkspaceLocked(id)
	return nil
}

// Info exposes the resolved data paths.
func (s *Store) Info() datadir.Info { return s.info }

// AppDB is used by the plugin registry.
func (s *Store) AppDB() *sql.DB { return s.appDB }

// Close checkpoints WAL state and closes every database.
func (s *Store) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	workspaces := make([]*WorkspaceDB, 0, len(s.workspaces))
	for _, ws := range s.workspaces {
		workspaces = append(workspaces, ws)
	}
	s.workspaces = map[string]*WorkspaceDB{}
	s.mu.Unlock()

	var firstErr error
	for _, ws := range workspaces {
		_, _ = ws.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
		if err := ws.DB.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	s.appMu.Lock()
	_, _ = s.appDB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	if err := s.appDB.Close(); err != nil && firstErr == nil {
		firstErr = err
	}
	s.appMu.Unlock()
	return firstErr
}

// ListWorkspaces returns registry entries with live page counts.
func (s *Store) ListWorkspaces() ([]Workspace, error) {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	rows, err := s.appDB.Query(`SELECT id,name,created_at,updated_at,last_opened_at FROM workspaces ORDER BY position, created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Workspace
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt, &w.LastOpenedAt); err != nil {
			return nil, err
		}
		if ws, err := s.workspace(w.ID); err == nil {
			var n int
			if err := ws.DB.QueryRow(`SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL`).Scan(&n); err == nil {
				w.PageCount = n
			}
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateWorkspace creates a new portable workspace directory and database.
func (s *Store) CreateWorkspace(name string) (Workspace, error) {
	name = cleanWorkspaceName(name)
	id := "ws_" + randomHex(8)
	now := nowString()
	if err := os.MkdirAll(s.info.WorkspaceRoot(id), 0o755); err != nil {
		return Workspace{}, fmt.Errorf("create workspace directory: %w", err)
	}
	s.mu.Lock()
	ws, err := s.openWorkspaceLocked(id, false)
	s.mu.Unlock()
	if err != nil {
		_ = os.RemoveAll(s.info.WorkspaceRoot(id))
		return Workspace{}, err
	}
	if err := s.seedFirstPage(ws, "Untitled", false); err != nil {
		_ = ws.DB.Close()
		_ = os.RemoveAll(s.info.WorkspaceRoot(id))
		return Workspace{}, err
	}
	s.appMu.Lock()
	_, err = s.appDB.Exec(`INSERT INTO workspaces(id,name,created_at,updated_at,last_opened_at,position) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM workspaces))`, id, name, now, now, now)
	s.appMu.Unlock()
	if err != nil {
		_ = ws.DB.Close()
		_ = os.RemoveAll(s.info.WorkspaceRoot(id))
		return Workspace{}, err
	}
	return Workspace{ID: id, Name: name, CreatedAt: now, UpdatedAt: now, LastOpenedAt: now, PageCount: 1}, nil
}

// RenameWorkspace updates a workspace name.
func (s *Store) RenameWorkspace(id, name string) (Workspace, error) {
	name = cleanWorkspaceName(name)
	s.appMu.Lock()
	defer s.appMu.Unlock()
	now := nowString()
	res, err := s.appDB.Exec(`UPDATE workspaces SET name=?, updated_at=? WHERE id=?`, name, now, id)
	if err != nil {
		return Workspace{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Workspace{}, fmt.Errorf("workspace not found")
	}
	var w Workspace
	if err := s.appDB.QueryRow(`SELECT id,name,created_at,updated_at,last_opened_at FROM workspaces WHERE id=?`, id).Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt, &w.LastOpenedAt); err != nil {
		return Workspace{}, err
	}
	return w, nil
}

func (s *Store) setLastWorkspace(id string) error {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	return s.setLastWorkspaceLocked(id)
}

func (s *Store) setLastWorkspaceLocked(id string) error {
	_, err := s.appDB.Exec(`INSERT INTO app_settings(key,value) VALUES('last_workspace',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, id)
	return err
}

// LastWorkspaceID returns the last successfully opened workspace, if any.
func (s *Store) LastWorkspaceID() string {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	var id string
	_ = s.appDB.QueryRow(`SELECT value FROM app_settings WHERE key='last_workspace'`).Scan(&id)
	return id
}

func (s *Store) setMeta(key, value string) error {
	s.appMu.Lock()
	defer s.appMu.Unlock()
	return s.setMetaLocked(key, value)
}

func (s *Store) setMetaLocked(key, value string) error {
	_, err := s.appDB.Exec(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// GetAppSettings loads global visual settings.
func (s *Store) GetAppSettings() AppSettings {
	out := DefaultAppSettings()
	s.appMu.Lock()
	defer s.appMu.Unlock()
	var raw string
	if err := s.appDB.QueryRow(`SELECT value FROM app_settings WHERE key='app'`).Scan(&raw); err != nil {
		return out
	}
	_ = jsonUnmarshal(raw, &out)
	if out.LeftWidth < 200 || out.LeftWidth > 520 {
		out.LeftWidth = 272
	}
	if out.RightWidth < 220 || out.RightWidth > 520 {
		out.RightWidth = 296
	}
	if out.Theme != "light" && out.Theme != "dark" && out.Theme != "system" {
		out.Theme = "system"
	}
	if out.EditorFont != "serif" && out.EditorFont != "sans" {
		out.EditorFont = "serif"
	}
	if out.FontSize < 15 || out.FontSize > 20 {
		out.FontSize = 17
	}
	if out.LineHeight < 1.45 || out.LineHeight > 1.9 {
		out.LineHeight = 1.68
	}
	if out.PageWidth < 640 || out.PageWidth > 900 {
		out.PageWidth = 780
	}
	if out.AutosaveDelay < 300 || out.AutosaveDelay > 2000 {
		out.AutosaveDelay = 700
	}
	return out
}

// SaveAppSettings persists global visual settings.
func (s *Store) SaveAppSettings(settings AppSettings) error {
	raw, err := jsonMarshal(settings)
	if err != nil {
		return err
	}
	s.appMu.Lock()
	defer s.appMu.Unlock()
	_, err = s.appDB.Exec(`INSERT INTO app_settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, raw)
	return err
}

// SwitchWorkspace opens a workspace, validates it, and records it as last used.
func (s *Store) SwitchWorkspace(id string) (*WorkspaceDB, Workspace, error) {
	s.appMu.Lock()
	var w Workspace
	err := s.appDB.QueryRow(`SELECT id,name,created_at,updated_at,last_opened_at FROM workspaces WHERE id=?`, id).Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt, &w.LastOpenedAt)
	if err == nil {
		_, err = s.appDB.Exec(`UPDATE workspaces SET last_opened_at=? WHERE id=?`, nowString(), id)
	}
	s.appMu.Unlock()
	if errors.Is(err, sql.ErrNoRows) {
		return nil, Workspace{}, fmt.Errorf("workspace not found")
	}
	if err != nil {
		return nil, Workspace{}, err
	}
	ws, err := s.workspace(id)
	if err != nil {
		return nil, Workspace{}, err
	}
	_ = s.setLastWorkspace(id)
	return ws, w, nil
}

func (s *Store) workspace(id string) (*WorkspaceDB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("store is closed")
	}
	if ws, ok := s.workspaces[id]; ok {
		return ws, nil
	}
	return s.openWorkspaceLocked(id, false)
}

func (s *Store) openWorkspaceLocked(id string, seedWelcome bool) (*WorkspaceDB, error) {
	if !idPattern.MatchString(id) {
		return nil, fmt.Errorf("invalid workspace id")
	}
	if err := os.MkdirAll(s.info.AssetsDir(id), 0o755); err != nil {
		return nil, fmt.Errorf("create workspace folder: %w", err)
	}
	db, err := openDB(s.info.WorkspaceDB(id))
	if err != nil {
		return nil, fmt.Errorf("open workspace %s: %w", id, err)
	}
	ws := &WorkspaceDB{DB: db, ID: id}
	if err := migrateWorkspace(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureWorkspaceSeed(ws); err != nil {
		_ = db.Close()
		return nil, err
	}
	if seedWelcome {
		var seeded string
		_ = s.appDB.QueryRow(`SELECT value FROM meta WHERE key='welcome_seeded'`).Scan(&seeded)
		if seeded == "" {
			if err := seedWelcomePage(ws); err != nil {
				_ = db.Close()
				return nil, err
			}
		}
	}
	s.workspaces[id] = ws
	log.Printf("noteral: opened workspace %s", id)
	return ws, nil
}

func (s *Store) seedFirstPage(ws *WorkspaceDB, title string, welcome bool) error {
	var n int
	if err := ws.DB.QueryRow(`SELECT COUNT(*) FROM pages`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if welcome {
		return seedWelcomePage(ws)
	}
	doc := emptyDocument()
	now := nowString()
	_, err := ws.DB.Exec(`INSERT INTO pages(id,parent_id,title,icon,position,doc_json,text_content,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		"pg_"+randomHex(8), "", title, "", 0, doc, "", 1, now, now)
	return err
}

func ensureWorkspaceSeed(ws *WorkspaceDB) error {
	var n int
	if err := ws.DB.QueryRow(`SELECT COUNT(*) FROM pages`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	return nil
}

func migrateWorkspace(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > schemaVersion {
		return fmt.Errorf("workspace was created by a newer version (schema %d, this build supports %d)", version, schemaVersion)
	}
	if version == 0 {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS pages (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT NOT NULL UNIQUE,
				parent_id TEXT NOT NULL DEFAULT '',
				title TEXT NOT NULL DEFAULT '',
				icon TEXT NOT NULL DEFAULT '',
				position REAL NOT NULL DEFAULT 0,
				doc_json TEXT NOT NULL DEFAULT '[]',
				text_content TEXT NOT NULL DEFAULT '',
				revision INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT
			)`,
			`CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, position)`,
			`CREATE INDEX IF NOT EXISTS idx_pages_updated ON pages(updated_at)`,
			`CREATE TABLE IF NOT EXISTS page_links (
				source_page_id TEXT NOT NULL,
				target_page_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY(source_page_id,target_page_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_links_target ON page_links(target_page_id)`,
			`CREATE TABLE IF NOT EXISTS favorites (
				page_id TEXT PRIMARY KEY,
				created_at TEXT NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS recent (
				page_id TEXT PRIMARY KEY,
				opened_at TEXT NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS tabs (
				page_id TEXT PRIMARY KEY,
				position INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS workspace_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
			`CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
				title, text_content, content='pages', content_rowid='seq',
				tokenize='unicode61 remove_diacritics 2'
			)`,
			`CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
				INSERT INTO pages_fts(rowid,title,text_content) VALUES(new.seq,new.title,new.text_content);
			END`,
			`CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
				INSERT INTO pages_fts(pages_fts,rowid,title,text_content) VALUES('delete',old.seq,old.title,old.text_content);
			END`,
			`CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE OF title,text_content ON pages BEGIN
				INSERT INTO pages_fts(pages_fts,rowid,title,text_content) VALUES('delete',old.seq,old.title,old.text_content);
				INSERT INTO pages_fts(rowid,title,text_content) VALUES(new.seq,new.title,new.text_content);
			END`,
			`PRAGMA user_version = 1`,
		}
		for _, stmt := range stmts {
			if _, err := tx.Exec(stmt); err != nil {
				return fmt.Errorf("initialize workspace database: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func nowString() string { return time.Now().UTC().Format(time.RFC3339Nano) }
