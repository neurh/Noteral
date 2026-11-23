package store

// Workspace is a top-level notebook.
type Workspace struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	LastOpenedAt string `json:"lastOpenedAt"`
	PageCount    int    `json:"pageCount"`
}

// Page kinds. A folder is a body-less container in the page tree; a database
// stores its schema and views in Data and its rows are its child pages, each
// carrying its property values in Data.
const (
	KindPage     = "page"
	KindFolder   = "folder"
	KindDatabase = "database"
)

// PageMeta is the lightweight sidebar/tab representation of a page. Bodies are
// deliberately not included here. Data is small structured JSON: a database's
// schema, or a database row's property values; it is empty for plain pages.
type PageMeta struct {
	ID        string  `json:"id"`
	ParentID  string  `json:"parentId"`
	Title     string  `json:"title"`
	Icon      string  `json:"icon"`
	Cover     string  `json:"cover"`
	Position  float64 `json:"position"`
	UpdatedAt string  `json:"updatedAt"`
	DeletedAt string  `json:"deletedAt,omitempty"`
	Kind      string  `json:"kind"`
	Data      string  `json:"data"`
	CreatedAt string  `json:"createdAt"`
}

// PageDocument is a full page body loaded on demand.
type PageDocument struct {
	PageMeta
	DocJSON  string `json:"docJson"`
	Revision int64  `json:"revision"`
}

// SaveResult confirms a committed save.
type SaveResult struct {
	Revision   int64  `json:"revision"`
	UpdatedAt  string `json:"updatedAt"`
	WordCount  int    `json:"wordCount"`
	BlockCount int    `json:"blockCount"`
}

// SearchHit is a full-text result.
type SearchHit struct {
	PageID    string `json:"pageId"`
	Title     string `json:"title"`
	Snippet   string `json:"snippet"`
	UpdatedAt string `json:"updatedAt"`
}

// HomeTabSettings customizes a single Home tab.
type HomeTabSettings struct {
	Template   string `json:"template"`
	Background string `json:"background"`
}

// WorkspaceSnapshot is everything needed to render a workspace shell without
// reading page bodies.
type WorkspaceSnapshot struct {
	Workspace    Workspace                  `json:"workspace"`
	Pages        []PageMeta                 `json:"pages"`
	Favorites    []string                   `json:"favorites"`
	Recent       []PageMeta                 `json:"recent"`
	Tabs         []string                   `json:"tabs"`
	ActiveTabID  string                     `json:"activeTabId"`
	ActivePageID string                     `json:"activePageId"`
	HomeTabs     map[string]HomeTabSettings `json:"homeTabs"`
	Layout       string                     `json:"layout,omitempty"`
	Trash        []PageMeta                 `json:"trash"`
}

// UISettings is per-workspace layout state. Tabs may contain page IDs and
// reserved "home:" tab IDs; ActiveTabID is the selected tab, while ActivePageID
// is empty when a Home tab is selected.
type UISettings struct {
	Tabs         []string                   `json:"tabs"`
	ActiveTabID  string                     `json:"activeTabId"`
	ActivePageID string                     `json:"activePageId"`
	HomeTabs     map[string]HomeTabSettings `json:"homeTabs,omitempty"`
	Layout       string                     `json:"layout,omitempty"`
}

// AppSettings is global application preference state.
type AppSettings struct {
	Theme         string  `json:"theme"` // light, dark, system
	LeftWidth     int     `json:"leftWidth"`
	RightWidth    int     `json:"rightWidth"`
	LeftOpen      bool    `json:"leftOpen"`
	RightOpen     bool    `json:"rightOpen"`
	RailOpen      bool    `json:"railOpen"`
	EditorFont    string  `json:"editorFont"`    // serif, sans
	FontSize      int     `json:"fontSize"`      // reading text size in px
	LineHeight    float64 `json:"lineHeight"`    // reading line height
	PageWidth     int     `json:"pageWidth"`     // maximum reading measure in px
	FullWidth     bool    `json:"fullWidth"`     // editor spans the available pane
	AutosaveDelay int     `json:"autosaveDelay"` // milliseconds after the last edit
	Spellcheck    bool    `json:"spellcheck"`
	ReduceMotion  bool    `json:"reduceMotion"`
	ShowStats     bool    `json:"showStats"`
}

// DefaultAppSettings returns the initial visual layout.
func DefaultAppSettings() AppSettings {
	return AppSettings{
		Theme:         "system",
		LeftWidth:     272,
		RightWidth:    296,
		LeftOpen:      true,
		RightOpen:     true,
		RailOpen:      true,
		EditorFont:    "serif",
		FontSize:      17,
		LineHeight:    1.68,
		PageWidth:     780,
		FullWidth:     false,
		AutosaveDelay: 700,
		Spellcheck:    true,
		ReduceMotion:  false,
		ShowStats:     true,
	}
}

// ConflictError means another writer changed the page between load and save.
type ConflictError struct {
	Expected int64
	Current  int64
}

func (e *ConflictError) Error() string {
	return "ERR_CONFLICT: note was changed by another writer (expected revision " + itoa(e.Expected) + ", found " + itoa(e.Current) + ")"
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
