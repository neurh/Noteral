package web

import (
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// brMark stands in for <br> inside inline text until whitespace has been
// collapsed.
const brMark = ''

type extraction struct {
	title, description, text string
	links                    []Link
}

// extract reduces an HTML document to its readable main content.
func extract(doc *html.Node, base *url.URL) extraction {
	var ex extraction
	if b := findFirst(doc, func(n *html.Node) bool { return n.DataAtom == atom.Base && attr(n, "href") != "" }); b != nil {
		if u, err := base.Parse(attr(b, "href")); err == nil {
			base = u
		}
	}
	ex.title, ex.description = pageMeta(doc)

	root := chooseRoot(doc)
	r := &renderer{base: base, root: root, rootLen: textLen(root), seen: map[string]bool{}}
	ex.text = normalizeMarkdown(strings.Join(r.renderBlocks(root), "\n\n"))
	ex.links = r.links
	if ex.title == "" {
		if h1 := findFirst(root, func(n *html.Node) bool { return n.DataAtom == atom.H1 }); h1 != nil {
			ex.title = collapseSpace(textContent(h1))
		}
	}
	return ex
}

func pageMeta(doc *html.Node) (title, description string) {
	var ogTitle, ogDesc, metaDesc string
	walkElements(doc, func(n *html.Node) bool {
		switch n.DataAtom {
		case atom.Title:
			if title == "" && n.Namespace == "" {
				title = collapseSpace(textContent(n))
			}
		case atom.Meta:
			content := collapseSpace(attr(n, "content"))
			key := strings.ToLower(attr(n, "property"))
			if key == "" {
				key = strings.ToLower(attr(n, "name"))
			}
			switch key {
			case "og:title":
				if ogTitle == "" {
					ogTitle = content
				}
			case "description":
				if metaDesc == "" {
					metaDesc = content
				}
			case "og:description", "twitter:description":
				if ogDesc == "" {
					ogDesc = content
				}
			}
		case atom.Body:
			return false // metadata lives in <head>
		}
		return true
	})
	if title == "" {
		title = ogTitle
	}
	description = metaDesc
	if description == "" {
		description = ogDesc
	}
	return title, description
}

// chooseRoot prefers <article> (the largest one), then <main>, then
// [role=main], then <body>.
func chooseRoot(doc *html.Node) *html.Node {
	var best *html.Node
	bestLen := 0
	walkElements(doc, func(n *html.Node) bool {
		if n.DataAtom == atom.Article {
			if l := textLen(n); l > bestLen {
				best, bestLen = n, l
			}
			return false // nested articles are part of this one
		}
		return true
	})
	if best != nil && bestLen >= 200 {
		return best
	}
	if m := findFirst(doc, func(n *html.Node) bool { return n.DataAtom == atom.Main }); m != nil && textLen(m) > 0 {
		return m
	}
	if m := findFirst(doc, func(n *html.Node) bool { return strings.EqualFold(attr(n, "role"), "main") }); m != nil && textLen(m) > 0 {
		return m
	}
	if best != nil {
		return best
	}
	if b := findFirst(doc, func(n *html.Node) bool { return n.DataAtom == atom.Body }); b != nil {
		return b
	}
	return doc
}

// --- skipping -------------------------------------------------------------

var skipTags = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Noscript: true, atom.Svg: true,
	atom.Iframe: true, atom.Nav: true, atom.Footer: true, atom.Aside: true,
	atom.Button: true, atom.Template: true, atom.Head: true, atom.Link: true,
	atom.Meta: true, atom.Object: true, atom.Embed: true, atom.Canvas: true,
	atom.Audio: true, atom.Video: true, atom.Select: true, atom.Input: true,
	atom.Textarea: true, atom.Dialog: true, atom.Math: true,
}

var skipRoles = map[string]bool{
	"navigation": true, "banner": true, "contentinfo": true,
	"complementary": true, "search": true, "dialog": true, "alertdialog": true,
}

// Class/id tokens that mark boilerplate. A token matches when it equals the
// word or carries it as a "-"/"_" separated prefix or suffix.
var junkWords = []string{
	"sidebar", "comments", "comment-section", "comment-list", "disqus",
	"newsletter", "breadcrumb", "breadcrumbs", "social-share", "share-buttons",
	"sharedaddy", "related-posts", "popup", "ad-slot", "ad-container",
	"ad-wrapper", "ad-banner", "advert", "advertisement", "sponsored",
}

// Substrings that are unambiguous anywhere in a token.
var junkSubstrings = []string{"cookie", "consent", "gdpr", "onetrust", "adsbygoogle"}

var exactJunk = map[string]bool{"ad": true, "ads": true}

func isJunkToken(t string) bool {
	if exactJunk[t] {
		return true
	}
	for _, s := range junkSubstrings {
		if strings.Contains(t, s) {
			return true
		}
	}
	for _, w := range junkWords {
		if t == w || strings.HasPrefix(t, w+"-") || strings.HasPrefix(t, w+"_") ||
			strings.HasSuffix(t, "-"+w) || strings.HasSuffix(t, "_"+w) {
			return true
		}
	}
	return false
}

func hasJunkClassOrID(n *html.Node) bool {
	for _, tok := range strings.Fields(strings.ToLower(attr(n, "class") + " " + attr(n, "id"))) {
		if isJunkToken(tok) {
			return true
		}
	}
	return false
}

// --- rendering ------------------------------------------------------------

type renderer struct {
	base    *url.URL
	root    *html.Node
	rootLen int
	links   []Link
	seen    map[string]bool
}

// skip reports whether n (an element) contributes nothing readable.
func (r *renderer) skip(n *html.Node) bool {
	if n == r.root {
		return false
	}
	if skipTags[n.DataAtom] || n.Namespace == "svg" || n.Namespace == "math" {
		return true
	}
	if _, ok := attrOK(n, "hidden"); ok {
		return true
	}
	if strings.EqualFold(attr(n, "aria-hidden"), "true") {
		return true
	}
	style := strings.ReplaceAll(strings.ToLower(attr(n, "style")), " ", "")
	if strings.Contains(style, "display:none") || strings.Contains(style, "visibility:hidden") {
		return true
	}
	if skipRoles[strings.ToLower(attr(n, "role"))] {
		return true
	}
	switch n.DataAtom {
	case atom.Html, atom.Body, atom.Main, atom.Article:
		return false
	case atom.Header:
		// Page headers go; an article's own header (title, byline) stays.
		return !hasAncestor(n, atom.Article) ||
			findFirst(n, func(m *html.Node) bool { return m.DataAtom == atom.H1 || m.DataAtom == atom.H2 }) == nil
	case atom.Form:
		// Some sites wrap the whole page in a <form>; only drop small ones.
		return r.minor(n)
	}
	if hasJunkClassOrID(n) {
		// Guard against wrappers such as "content-with-sidebar".
		return r.minor(n)
	}
	return false
}

// minor reports whether n holds a small share of the main content's text.
func (r *renderer) minor(n *html.Node) bool {
	return r.rootLen == 0 || textLen(n)*10 < r.rootLen*4
}

type blockCtx struct {
	r      *renderer
	blocks []string
	inline strings.Builder
}

func (b *blockCtx) flush() {
	s := finishInline(b.inline.String())
	b.inline.Reset()
	if s != "" {
		b.blocks = append(b.blocks, s)
	}
}

func (b *blockCtx) add(block string) {
	b.flush()
	if block != "" {
		b.blocks = append(b.blocks, block)
	}
}

// renderBlocks renders the children of n into Markdown blocks.
func (r *renderer) renderBlocks(n *html.Node) []string {
	b := &blockCtx{r: r}
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		b.walk(ch)
	}
	b.flush()
	return b.blocks
}

// renderInline renders the children of n as a single line.
func (r *renderer) renderInline(n *html.Node) string {
	return collapseSpace(strings.Join(r.renderBlocks(n), " "))
}

func (b *blockCtx) walk(n *html.Node) {
	r := b.r
	switch n.Type {
	case html.TextNode:
		b.inline.WriteString(n.Data)
		return
	case html.DocumentNode:
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			b.walk(ch)
		}
		return
	case html.ElementNode:
	default:
		return
	}
	if r.skip(n) {
		return
	}
	switch n.DataAtom {
	case atom.Br:
		b.inline.WriteRune(brMark)
	case atom.Hr:
		b.add("---")
	case atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6:
		if t := r.renderInline(n); t != "" {
			level := int(n.Data[1] - '0')
			b.add(strings.Repeat("#", level) + " " + t)
		} else {
			b.flush()
		}
	case atom.Pre:
		b.add(renderPre(n))
	case atom.Ul, atom.Ol, atom.Menu:
		b.add(r.renderList(n))
	case atom.Li:
		b.add(listItem("- ", strings.Join(r.renderBlocks(n), "\n")))
	case atom.Blockquote:
		b.add(prefixLines(strings.Join(r.renderBlocks(n), "\n\n"), "> "))
	case atom.Table:
		if isLayoutTable(n) {
			b.container(n)
		} else {
			b.add(r.renderTable(n))
		}
	case atom.A:
		b.link(n)
	case atom.Img:
		b.image(n)
	case atom.Code, atom.Kbd, atom.Samp, atom.Tt:
		b.code(n)
	default:
		if isBlockTag(n.DataAtom) {
			b.container(n)
			return
		}
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			b.walk(ch)
		}
	}
}

func (b *blockCtx) container(n *html.Node) {
	b.flush()
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		b.walk(ch)
	}
	b.flush()
}

// writeSpaced writes s, keeping the whitespace that surrounded the element.
func (b *blockCtx) writeSpaced(n *html.Node, s string) {
	raw := textContent(n)
	if raw != "" && unicode.IsSpace(rune(raw[0])) {
		b.inline.WriteByte(' ')
	}
	b.inline.WriteString(s)
	if raw != "" && unicode.IsSpace(rune(raw[len(raw)-1])) {
		b.inline.WriteByte(' ')
	}
}

func (b *blockCtx) link(n *html.Node) {
	r := b.r
	text := r.renderInline(n)
	href := r.resolve(attr(n, "href"))
	if href == "" || text == "" {
		b.writeSpaced(n, text)
		return
	}
	label := collapseSpace(textContent(n))
	if label == "" {
		label = collapseSpace(attr(n, "aria-label"))
	}
	if label == "" {
		label = collapseSpace(attr(n, "title"))
	}
	r.addLink(label, href)
	b.writeSpaced(n, "["+escapeLinkText(text)+"]("+markdownURL(href)+")")
}

func (b *blockCtx) image(n *html.Node) {
	alt := collapseSpace(attr(n, "alt"))
	if alt == "" {
		return
	}
	src := attr(n, "src")
	if src == "" || strings.HasPrefix(src, "data:") {
		src = attr(n, "data-src")
	}
	if u := b.r.resolve(src); u != "" {
		b.inline.WriteString("![" + escapeLinkText(alt) + "](" + markdownURL(u) + ")")
	}
}

func (b *blockCtx) code(n *html.Node) {
	t := collapseSpace(textContent(n))
	if t == "" {
		return
	}
	fence := "`"
	if strings.Contains(t, "`") {
		fence = "``"
		t = " " + t + " "
	}
	b.writeSpaced(n, fence+t+fence)
}

func (r *renderer) addLink(text, href string) {
	if len(r.links) >= maxPageLinks || r.seen[href] {
		return
	}
	r.seen[href] = true
	r.links = append(r.links, Link{Text: text, URL: href})
}

// resolve makes href absolute. It returns "" for non-http(s) targets and
// for anchors into the current document.
func (r *renderer) resolve(href string) string {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "#") {
		return ""
	}
	u, err := r.base.Parse(href)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	if u.Fragment != "" {
		same := *u
		same.Fragment = ""
		self := *r.base
		self.Fragment = ""
		if same.String() == self.String() {
			return ""
		}
	}
	return u.String()
}

func (r *renderer) renderList(n *html.Node) string {
	ordered := n.DataAtom == atom.Ol
	num := 1
	if s, err := strconv.Atoi(attr(n, "start")); err == nil && ordered {
		num = s
	}
	var items []string
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		if ch.Type != html.ElementNode {
			if ch.Type == html.TextNode && strings.TrimSpace(ch.Data) != "" {
				items = append(items, listItem("- ", collapseSpace(ch.Data)))
			}
			continue
		}
		if r.skip(ch) {
			continue
		}
		if ch.DataAtom == atom.Ul || ch.DataAtom == atom.Ol {
			// Invalid but common: a list nested directly in a list.
			if nested := r.renderList(ch); nested != "" {
				items = append(items, prefixLines(nested, "  "))
			}
			continue
		}
		var content string
		if ch.DataAtom == atom.Li {
			content = strings.Join(r.renderBlocks(ch), "\n")
		} else {
			b := &blockCtx{r: r}
			b.walk(ch)
			b.flush()
			content = strings.Join(b.blocks, "\n")
		}
		if strings.TrimSpace(content) == "" {
			continue
		}
		marker := "- "
		if ordered {
			marker = strconv.Itoa(num) + ". "
			num++
		}
		items = append(items, listItem(marker, content))
	}
	return strings.Join(items, "\n")
}

// listItem prefixes the first line with marker and indents the rest.
func listItem(marker, content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	pad := strings.Repeat(" ", len(marker))
	lines := strings.Split(content, "\n")
	for i, l := range lines {
		if i == 0 {
			lines[i] = marker + l
		} else if strings.TrimSpace(l) != "" {
			lines[i] = pad + l
		}
	}
	return strings.Join(lines, "\n")
}

func prefixLines(s, prefix string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if l == "" {
			lines[i] = strings.TrimRight(prefix, " ")
		} else {
			lines[i] = prefix + l
		}
	}
	return strings.Join(lines, "\n")
}

func renderPre(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(m *html.Node) {
		switch {
		case m.Type == html.TextNode:
			b.WriteString(m.Data)
		case m.Type == html.ElementNode && m.DataAtom == atom.Br:
			b.WriteByte('\n')
		case m.Type == html.ElementNode && (m.DataAtom == atom.Script || m.DataAtom == atom.Style):
		default:
			for ch := m.FirstChild; ch != nil; ch = ch.NextSibling {
				walk(ch)
			}
		}
	}
	walk(n)
	code := strings.TrimRight(strings.TrimPrefix(b.String(), "\n"), " \t\r\n")
	code = strings.ReplaceAll(code, " ", " ")
	if strings.TrimSpace(code) == "" {
		return ""
	}
	lang := codeLang(n)
	if c := findFirst(n, func(m *html.Node) bool { return m.DataAtom == atom.Code }); lang == "" && c != nil {
		lang = codeLang(c)
	}
	fence := "```"
	for strings.Contains(code, fence) {
		fence += "`"
	}
	return fence + lang + "\n" + code + "\n" + fence
}

func codeLang(n *html.Node) string {
	for _, c := range strings.Fields(attr(n, "class")) {
		for _, p := range []string{"language-", "lang-"} {
			if strings.HasPrefix(c, p) && len(c) > len(p) {
				return c[len(p):]
			}
		}
	}
	return ""
}

// --- tables ---------------------------------------------------------------

// tableRows returns the rows of t, ignoring rows of nested tables.
func tableRows(t *html.Node) [][]*html.Node {
	var rows [][]*html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			if ch.Type != html.ElementNode {
				continue
			}
			switch ch.DataAtom {
			case atom.Table:
				continue
			case atom.Tr:
				var cells []*html.Node
				for c := ch.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.ElementNode && (c.DataAtom == atom.Td || c.DataAtom == atom.Th) {
						cells = append(cells, c)
					}
				}
				rows = append(rows, cells)
			default:
				walk(ch)
			}
		}
	}
	walk(t)
	return rows
}

// isLayoutTable detects tables used for page layout rather than data.
func isLayoutTable(t *html.Node) bool {
	if r := strings.ToLower(attr(t, "role")); r == "presentation" || r == "none" {
		return true
	}
	nested := false
	walkElements(t, func(n *html.Node) bool {
		if n != t && n.DataAtom == atom.Table {
			nested = true
		}
		return !nested
	})
	if nested {
		return true
	}
	maxCols := 0
	for _, row := range tableRows(t) {
		maxCols = max(maxCols, len(row))
	}
	return maxCols <= 1
}

func (r *renderer) renderTable(t *html.Node) string {
	var caption string
	if c := findFirst(t, func(n *html.Node) bool { return n.DataAtom == atom.Caption }); c != nil {
		caption = r.renderInline(c)
	}
	var rows [][]string
	cols := 0
	header := false
	for _, cells := range tableRows(t) {
		if len(rows) == 0 {
			header = len(cells) > 0
			for _, c := range cells {
				header = header && c.DataAtom == atom.Th
			}
		}
		var row []string
		nonEmpty := false
		for _, c := range cells {
			s := strings.ReplaceAll(r.renderInline(c), "|", `\|`)
			if s != "" {
				nonEmpty = true
			}
			row = append(row, s)
		}
		if !nonEmpty {
			continue
		}
		cols = max(cols, len(row))
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return caption
	}
	var b strings.Builder
	if caption != "" {
		b.WriteString(caption + "\n\n")
	}
	for i, row := range rows {
		for len(row) < cols {
			row = append(row, "")
		}
		b.WriteString("| " + strings.Join(row, " | ") + " |\n")
		if i == 0 && header {
			b.WriteString("|" + strings.Repeat(" --- |", cols) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// --- text helpers ---------------------------------------------------------

var blockTags = map[atom.Atom]bool{
	atom.Address: true, atom.Article: true, atom.Aside: true, atom.Blockquote: true,
	atom.Body: true, atom.Caption: true, atom.Center: true, atom.Dd: true,
	atom.Details: true, atom.Dialog: true, atom.Dir: true, atom.Div: true,
	atom.Dl: true, atom.Dt: true, atom.Fieldset: true, atom.Figcaption: true,
	atom.Figure: true, atom.Footer: true, atom.Form: true, atom.H1: true,
	atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true,
	atom.Header: true, atom.Hgroup: true, atom.Hr: true, atom.Html: true,
	atom.Legend: true, atom.Li: true, atom.Main: true, atom.Menu: true,
	atom.Nav: true, atom.Ol: true, atom.P: true, atom.Pre: true,
	atom.Section: true, atom.Summary: true, atom.Table: true, atom.Tbody: true,
	atom.Td: true, atom.Tfoot: true, atom.Th: true, atom.Thead: true,
	atom.Tr: true, atom.Ul: true,
}

func isBlockTag(a atom.Atom) bool { return blockTags[a] }

// finishInline collapses whitespace and turns <br> marks into newlines.
func finishInline(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	parts := strings.Split(s, string(brMark))
	out := parts[:0]
	for _, p := range parts {
		out = append(out, collapseSpace(p))
	}
	return strings.Trim(strings.Join(out, "\n"), "\n ")
}

// collapseSpace folds whitespace runs (including NBSP) into single spaces.
func collapseSpace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if unicode.IsSpace(r) || r == ' ' {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

// normalizeMarkdown trims trailing spaces and keeps at most one blank line
// in a row outside fenced code.
func normalizeMarkdown(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	inFence := false
	blank := 0
	for _, l := range lines {
		if strings.HasPrefix(strings.TrimLeft(l, " >-0123456789."), "```") {
			inFence = !inFence
		}
		if !inFence {
			l = strings.TrimRight(l, " \t")
			if l == "" {
				blank++
				if blank > 1 {
					continue
				}
			} else {
				blank = 0
			}
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

var linkTextEscaper = strings.NewReplacer("[", `\[`, "]", `\]`)

func escapeLinkText(s string) string {
	// Keep nested image syntax intact.
	if strings.HasPrefix(s, "![") {
		return s
	}
	return linkTextEscaper.Replace(s)
}

var markdownURLEscaper = strings.NewReplacer("(", "%28", ")", "%29", " ", "%20")

func markdownURL(u string) string { return markdownURLEscaper.Replace(u) }

func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(m *html.Node) {
		if m.Type == html.TextNode {
			b.WriteString(m.Data)
			return
		}
		if m.Type == html.ElementNode && (m.DataAtom == atom.Script || m.DataAtom == atom.Style || m.DataAtom == atom.Template) {
			return
		}
		for ch := m.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(n)
	return b.String()
}

// textLen counts non-space characters of visible text under n.
func textLen(n *html.Node) int {
	count := 0
	var walk func(*html.Node)
	walk = func(m *html.Node) {
		if m.Type == html.TextNode {
			for _, r := range m.Data {
				if !unicode.IsSpace(r) {
					count++
				}
			}
			return
		}
		if m.Type == html.ElementNode {
			switch m.DataAtom {
			case atom.Script, atom.Style, atom.Noscript, atom.Template, atom.Svg:
				return
			}
		}
		for ch := m.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(n)
	return count
}

func attr(n *html.Node, key string) string {
	v, _ := attrOK(n, key)
	return v
}

func attrOK(n *html.Node, key string) (string, bool) {
	for _, a := range n.Attr {
		if a.Namespace == "" && a.Key == key {
			return a.Val, true
		}
	}
	return "", false
}

func hasClass(n *html.Node, class string) bool {
	for _, c := range strings.Fields(attr(n, "class")) {
		if c == class {
			return true
		}
	}
	return false
}

func hasAncestor(n *html.Node, a atom.Atom) bool {
	for p := n.Parent; p != nil; p = p.Parent {
		if p.Type == html.ElementNode && p.DataAtom == a {
			return true
		}
	}
	return false
}

// walkElements visits element nodes depth-first; returning false from fn
// skips the node's children.
func walkElements(n *html.Node, fn func(*html.Node) bool) {
	if n.Type == html.ElementNode && !fn(n) {
		return
	}
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		walkElements(ch, fn)
	}
}

// findFirst returns the first element under n (including n) matching fn.
func findFirst(n *html.Node, fn func(*html.Node) bool) *html.Node {
	if n.Type == html.ElementNode && fn(n) {
		return n
	}
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		if m := findFirst(ch, fn); m != nil {
			return m
		}
	}
	return nil
}
