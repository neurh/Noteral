package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
)

// maxBrowserState bounds the in-app browser's saved state (open tabs with
// their back/forward lists, bookmarks, history and preferences).
const maxBrowserState = 1 << 20

// GetBrowserState returns the workspace's in-app browser state as a JSON
// object, or "{}" when nothing was saved yet. The frontend owns its shape.
func (s *Store) GetBrowserState(workspaceID string) (string, error) {
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return "", err
	}
	var raw string
	err = ws.DB.QueryRow(`SELECT value FROM workspace_settings WHERE key='browser'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "{}", nil
	}
	if err != nil {
		return "", err
	}
	return raw, nil
}

// SaveBrowserState stores the in-app browser state. It must be a JSON object
// no larger than 1 MiB.
func (s *Store) SaveBrowserState(workspaceID, doc string) error {
	if len(doc) > maxBrowserState {
		return errors.New("browser state is too large")
	}
	trimmed := bytes.TrimSpace([]byte(doc))
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		return errors.New("browser state must be a JSON object")
	}
	ws, err := s.workspace(workspaceID)
	if err != nil {
		return err
	}
	_, err = ws.DB.Exec(`INSERT INTO workspace_settings(key,value) VALUES('browser',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(trimmed))
	return err
}
