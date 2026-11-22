package store

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// BackupIfNeeded creates one consistent vacuum snapshot per day and keeps the
// most recent seven snapshots. It is deliberately asynchronous and never
// prevents startup; failures are logged and the live databases stay authoritative.
func (s *Store) BackupIfNeeded() {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	day := time.Now().Format("2006-01-02")
	final := filepath.Join(s.info.BackupsDir, day)
	if _, err := os.Stat(filepath.Join(final, "noteral.db")); err == nil {
		return
	}
	if err := os.MkdirAll(s.info.BackupsDir, 0o755); err != nil {
		log.Printf("noteral: backup skipped: %v", err)
		return
	}
	tmp, err := os.MkdirTemp(s.info.BackupsDir, ".backup-*")
	if err != nil {
		log.Printf("noteral: backup skipped: %v", err)
		return
	}
	defer os.RemoveAll(tmp)
	if err := s.writeBackup(tmp); err != nil {
		log.Printf("noteral: backup failed: %v", err)
		return
	}
	if err := os.RemoveAll(final); err != nil {
		log.Printf("noteral: backup cleanup: %v", err)
		return
	}
	if err := os.Rename(tmp, final); err != nil {
		log.Printf("noteral: backup finalize: %v", err)
		return
	}
	s.pruneBackups()
	log.Printf("noteral: daily backup written to %s", final)
}

func (s *Store) writeBackup(dir string) error {
	wsDir := filepath.Join(dir, "workspaces")
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		return err
	}
	s.appMu.Lock()
	_, err := s.appDB.Exec(`VACUUM INTO ?`, filepath.Join(dir, "noteral.db"))
	if err != nil {
		s.appMu.Unlock()
		return fmt.Errorf("snapshot app database: %w", err)
	}
	rows, err := s.appDB.Query(`SELECT id,name FROM workspaces ORDER BY position`)
	var ids []string
	names := map[string]string{}
	if err == nil {
		for rows.Next() {
			var id, name string
			if rows.Scan(&id, &name) == nil {
				ids = append(ids, id)
				names[id] = name
			}
		}
		rows.Close()
	}
	s.appMu.Unlock()
	if err != nil {
		return fmt.Errorf("list workspaces for backup: %w", err)
	}
	for _, id := range ids {
		ws, err := s.workspace(id)
		if err != nil {
			return fmt.Errorf("open workspace %s for backup: %w", id, err)
		}
		if _, err := ws.DB.Exec(`VACUUM INTO ?`, filepath.Join(wsDir, id+".db")); err != nil {
			return fmt.Errorf("snapshot workspace %s: %w", id, err)
		}
	}
	manifest := map[string]any{
		"createdAt":  nowString(),
		"schema":     schemaVersion,
		"workspaces": names,
		"note":       "Portable Noteral backup. Restore by copying noteral.db and workspaces/ into a Data directory.",
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")
	return os.WriteFile(filepath.Join(dir, "manifest.json"), b, 0o644)
}

func (s *Store) pruneBackups() {
	entries, err := os.ReadDir(s.info.BackupsDir)
	if err != nil {
		return
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() && len(e.Name()) == 10 {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs)
	for len(dirs) > 7 {
		_ = os.RemoveAll(filepath.Join(s.info.BackupsDir, dirs[0]))
		dirs = dirs[1:]
	}
}
