package blocknote

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// RenderOptions controls Markdown conversion.
type RenderOptions struct {
	Title            string
	ResolvePageTitle func(pageID string) string
	AssetURL         func(relative string) string
}

// RenderMarkdown converts a BlockNote document into readable Markdown. Custom
// page links are emitted as noteral-page:// links, which the desktop app and
// Markdown export can resolve later. Unknown blocks degrade to their text
// rather than being dropped.
func RenderMarkdown(raw string, opts RenderOptions) (string, error) {
	blocks, err := Parse(raw)
	if err != nil {
		return "", err
	}
	title := strings.TrimSpace(opts.Title)
	var b strings.Builder
	if title != "" {
		b.WriteString("# ")
		b.WriteString(escapeInline(title))
		b.WriteString("\n\n")
	}
	for i, item := range blocks {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		rendered := renderBlock(block, 0, opts)
		if strings.TrimSpace(rendered) == "" {
			continue
		}
		if i > 0 && b.Len() > 0 && !strings.HasSuffix(b.String(), "\n\n") {
			b.WriteString("\n\n")
		}
		b.WriteString(rendered)
	}
	if b.Len() == 0 {
		return "", nil
	}
	return strings.TrimRight(b.String(), "\n") + "\n", nil
}

func renderBlock(block map[string]any, depth int, opts RenderOptions) string {
	typ, _ := block["type"].(string)
	props, _ := block["props"].(map[string]any)
	content := block["content"]
	children, _ := block["children"].([]any)

	var body string
	switch typ {
	case "heading":
		level := 1
		if f, ok := number(props["level"]); ok && f >= 1 && f <= 6 {
			level = int(f)
		}
		body = strings.Repeat("#", level) + " " + renderInline(content, opts)
	case "quote":
		text := renderInline(content, opts)
		lines := strings.Split(text, "\n")
		for i, line := range lines {
			lines[i] = "> " + line
		}
		body = strings.Join(lines, "\n")
	case "callout":
		icon, _ := props["icon"].(string)
		text := renderInline(content, opts)
		if icon != "" {
			text = icon + " " + text
		}
		lines := strings.Split(text, "\n")
		for i, line := range lines {
			lines[i] = "> " + line
		}
		body = strings.Join(lines, "\n")
	case "codeBlock":
		lang, _ := props["language"].(string)
		code := plainInline(content)
		fence := "```"
		for strings.Contains(code, fence) {
			fence += "`"
		}
		body = fence + lang + "\n" + code + "\n" + fence
	case "bulletListItem":
		body = "- " + renderInline(content, opts)
	case "numberedListItem":
		body = "1. " + renderInline(content, opts)
	case "checkListItem":
		checked, _ := props["checked"].(bool)
		box := " "
		if checked {
			box = "x"
		}
		body = "- [" + box + "] " + renderInline(content, opts)
	case "toggleListItem":
		body = "- " + renderInline(content, opts)
	case "image":
		alt, _ := props["caption"].(string)
		if alt == "" {
			alt, _ = props["name"].(string)
		}
		url := normalizeAssetURL(props["url"], opts)
		body = "![" + escapeInline(alt) + "](" + escapeURL(url) + ")"
	case "file":
		name, _ := props["name"].(string)
		if name == "" {
			name = "Attachment"
		}
		body = "[" + escapeInline(name) + "](" + escapeURL(normalizeAssetURL(props["url"], opts)) + ")"
	case "audio":
		body = "[" + escapeInline(firstString(props, "name", "Audio")) + "](" + escapeURL(normalizeAssetURL(props["url"], opts)) + ")"
	case "video":
		body = "[" + escapeInline(firstString(props, "name", "Video")) + "](" + escapeURL(normalizeAssetURL(props["url"], opts)) + ")"
	case "table":
		body = renderTable(content, opts)
	case "divider", "pageBreak":
		body = "---"
	case "database":
		id, _ := props["databaseId"].(string)
		title := "Untitled database"
		if opts.ResolvePageTitle != nil && id != "" {
			if t := opts.ResolvePageTitle(id); strings.TrimSpace(t) != "" {
				title = t
			}
		}
		body = "[" + escapeInline(title) + "](noteral-page://" + escapeURL(id) + ")"
	default:
		body = renderInline(content, opts)
	}

	if len(children) > 0 {
		indent := strings.Repeat("  ", depth+1)
		var childLines []string
		for _, child := range children {
			cm, ok := child.(map[string]any)
			if !ok {
				continue
			}
			r := renderBlock(cm, depth+1, opts)
			if strings.TrimSpace(r) == "" {
				continue
			}
			for _, line := range strings.Split(r, "\n") {
				if strings.TrimSpace(line) == "" {
					childLines = append(childLines, "")
					continue
				}
				childLines = append(childLines, indent+line)
			}
		}
		if len(childLines) > 0 {
			if body != "" {
				body += "\n"
			}
			body += strings.Join(childLines, "\n")
		}
	}
	return body
}

func renderTable(content any, opts RenderOptions) string {
	m, ok := content.(map[string]any)
	if !ok {
		return ""
	}
	rows, _ := m["rows"].([]any)
	if len(rows) == 0 {
		return ""
	}
	var lines []string
	width := 0
	for ri, row := range rows {
		rm, ok := row.(map[string]any)
		if !ok {
			continue
		}
		cells, _ := rm["cells"].([]any)
		var rendered []string
		for _, cell := range cells {
			rendered = append(rendered, strings.ReplaceAll(renderInline(cell, opts), "|", "\\|"))
		}
		if len(rendered) > width {
			width = len(rendered)
		}
		lines = append(lines, "| "+strings.Join(rendered, " | ")+" |")
		if ri == 0 {
			sep := make([]string, len(rendered))
			for i := range sep {
				sep[i] = "---"
			}
			lines = append(lines, "| "+strings.Join(sep, " | ")+" |")
		}
	}
	return strings.Join(lines, "\n")
}

func renderInline(content any, opts RenderOptions) string {
	switch c := content.(type) {
	case string:
		return escapeInline(c)
	case []any:
		var b strings.Builder
		for _, item := range c {
			b.WriteString(renderInline(item, opts))
		}
		return b.String()
	case map[string]any:
		typ, _ := c["type"].(string)
		switch typ {
		case "text":
			text, _ := c["text"].(string)
			return applyStyles(escapeInline(text), c["styles"])
		case "link":
			href, _ := c["href"].(string)
			if href == "" {
				if p, ok := c["props"].(map[string]any); ok {
					href, _ = p["href"].(string)
				}
			}
			return "[" + renderInline(c["content"], opts) + "](" + escapeURL(href) + ")"
		case "pageLink", "noteralPageLink":
			props, _ := c["props"].(map[string]any)
			id, _ := props["pageId"].(string)
			title := "Untitled page"
			if opts.ResolvePageTitle != nil && id != "" {
				if t := opts.ResolvePageTitle(id); strings.TrimSpace(t) != "" {
					title = t
				}
			}
			return "[" + escapeInline(title) + "](noteral-page://" + escapeURL(id) + ")"
		case "hardBreak":
			return "  \n"
		}
		if inner, ok := c["content"]; ok {
			return renderInline(inner, opts)
		}
		if text, ok := c["text"].(string); ok {
			return escapeInline(text)
		}
	}
	return ""
}

func applyStyles(text string, styles any) string {
	m, ok := styles.(map[string]any)
	if !ok {
		return text
	}
	if truthy(m["code"]) {
		return "`" + strings.ReplaceAll(text, "`", "\\`") + "`"
	}
	if truthy(m["bold"]) {
		text = "**" + text + "**"
	}
	if truthy(m["italic"]) {
		text = "*" + text + "*"
	}
	if truthy(m["strike"]) {
		text = "~~" + text + "~~"
	}
	if truthy(m["underline"]) {
		text = "<u>" + text + "</u>"
	}
	return text
}

func truthy(v any) bool {
	b, _ := v.(bool)
	return b
}

func plainInline(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case []any:
		var b strings.Builder
		for _, item := range c {
			b.WriteString(plainInline(item))
		}
		return b.String()
	case map[string]any:
		if t, ok := c["text"].(string); ok {
			return t
		}
		if inner, ok := c["content"]; ok {
			return plainInline(inner)
		}
	}
	return ""
}

func normalizeAssetURL(v any, opts RenderOptions) string {
	url, _ := v.(string)
	if opts.AssetURL != nil && url != "" && !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "data:") && !strings.HasPrefix(url, "blob:") {
		return opts.AssetURL(url)
	}
	return url
}

func firstString(m map[string]any, key, fallback string) string {
	if s, ok := m[key].(string); ok && s != "" {
		return s
	}
	return fallback
}

func number(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	}
	return 0, false
}

func escapeInline(s string) string {
	r := strings.NewReplacer(
		"\\", "\\\\",
		"*", "\\*",
		"_", "\\_",
		"[", "\\[",
		"]", "\\]",
		"`", "\\`",
		"<", "&lt;",
		">", "&gt;",
	)
	return r.Replace(s)
}

func escapeURL(s string) string {
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, ")", "%29")
	s = strings.ReplaceAll(s, " ", "%20")
	return s
}

// RenderError wraps conversion errors with context.
func RenderError(err error) error {
	return fmt.Errorf("render Markdown: %w", err)
}
