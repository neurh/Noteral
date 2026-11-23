package store

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// The database schema and row values are owned by the frontend; the store
// treats them as opaque JSON except for exports, which read this subset.
type dbSchema struct {
	TitleName  string       `json:"titleName"`
	Properties []dbProperty `json:"properties"`
}

type dbProperty struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Type    string     `json:"type"`
	Options []dbOption `json:"options"`
}

type dbOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type dbRow struct {
	Values map[string]any `json:"values"`
}

// databaseMarkdown renders a database page's rows as a Markdown table.
func databaseMarkdown(title, schemaJSON string, rows []PageMeta) string {
	var schema dbSchema
	_ = json.Unmarshal([]byte(schemaJSON), &schema)
	titleName := strings.TrimSpace(schema.TitleName)
	if titleName == "" {
		titleName = "Name"
	}
	var b strings.Builder
	if t := strings.TrimSpace(title); t != "" {
		b.WriteString("# " + escapeCell(t) + "\n\n")
	}
	header := []string{titleName}
	for _, p := range schema.Properties {
		header = append(header, p.Name)
	}
	b.WriteString("| " + strings.Join(mapCells(header), " | ") + " |\n")
	b.WriteString("|" + strings.Repeat(" --- |", len(header)) + "\n")
	for _, row := range rows {
		var data dbRow
		_ = json.Unmarshal([]byte(row.Data), &data)
		cells := []string{row.Title}
		for _, p := range schema.Properties {
			cells = append(cells, formatDBValue(p, data.Values[p.ID], row))
		}
		b.WriteString("| " + strings.Join(mapCells(cells), " | ") + " |\n")
	}
	return b.String()
}

func mapCells(in []string) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = escapeCell(v)
	}
	return out
}

func escapeCell(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.ReplaceAll(s, "|", "\\|")
}

func formatDBValue(p dbProperty, v any, row PageMeta) string {
	optionName := func(id string) string {
		for _, o := range p.Options {
			if o.ID == id {
				return o.Name
			}
		}
		return ""
	}
	switch p.Type {
	case "createdTime":
		return row.CreatedAt
	case "lastEdited":
		return row.UpdatedAt
	case "checkbox":
		if b, _ := v.(bool); b {
			return "[x]"
		}
		return "[ ]"
	case "select", "status":
		if id, ok := v.(string); ok {
			return optionName(id)
		}
		return ""
	case "multiSelect":
		list, _ := v.([]any)
		var names []string
		for _, item := range list {
			if id, ok := item.(string); ok {
				if n := optionName(id); n != "" {
					names = append(names, n)
				}
			}
		}
		return strings.Join(names, ", ")
	case "date":
		if m, ok := v.(map[string]any); ok {
			start, _ := m["start"].(string)
			end, _ := m["end"].(string)
			if end != "" {
				return start + " → " + end
			}
			return start
		}
	}
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		return fmt.Sprint(x)
	}
}
