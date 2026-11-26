package blocknote

import (
	"strings"
	"testing"
)

func TestAnalyzeExtractsTextLinksAndAssets(t *testing.T) {
	doc := `[
	  {"id":"b1","type":"heading","props":{"level":2},"content":[{"type":"text","text":"Project notes","styles":{}}],"children":[]},
	  {"id":"b2","type":"paragraph","props":{},"content":[
	    {"type":"text","text":"See ","styles":{}},
	    {"type":"pageLink","props":{"pageId":"pg_target"}},
	    {"type":"link","href":"noteral-page://pg_other","content":[{"type":"text","text":"other","styles":{}}]}
	  ],"children":[
	    {"id":"b3","type":"paragraph","props":{},"content":[{"type":"text","text":"Nested thought","styles":{}}],"children":[]}
	  ]},
	  {"id":"b4","type":"image","props":{"url":"assets/2026/01/photo.png","caption":"A photo"},"children":[]},
	  {"id":"b5","type":"image","props":{"url":"https://example.com/remote.png"},"children":[]}
	]`
	analysis, err := Analyze(doc)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if !strings.Contains(analysis.Text, "Project notes") || !strings.Contains(analysis.Text, "Nested thought") {
		t.Fatalf("missing text: %q", analysis.Text)
	}
	if len(analysis.Backlinks) != 2 || analysis.Backlinks[0] == analysis.Backlinks[1] {
		t.Fatalf("unexpected backlinks: %#v", analysis.Backlinks)
	}
	if len(analysis.Assets) != 1 || analysis.Assets[0] != "assets/2026/01/photo.png" {
		t.Fatalf("unexpected assets: %#v", analysis.Assets)
	}
	if analysis.BlockCount != 5 {
		t.Fatalf("block count = %d", analysis.BlockCount)
	}
	if analysis.WordCount != 6 {
		t.Fatalf("word count = %d", analysis.WordCount)
	}
}

func TestCountWords(t *testing.T) {
	if got := CountWords("Hello, world! 你好"); got != 4 {
		t.Fatalf("CountWords = %d, want 4", got)
	}
	if got := CountWords(""); got != 0 {
		t.Fatalf("CountWords empty = %d", got)
	}
}

func TestRenderMarkdown(t *testing.T) {
	doc := `[
	  {"id":"b1","type":"paragraph","props":{},"content":[
	    {"type":"text","text":"Read ","styles":{}},
	    {"type":"pageLink","props":{"pageId":"pg_2"}},
	    {"type":"text","text":" and ","styles":{}},
	    {"type":"link","href":"https://example.com","content":[{"type":"text","text":"web","styles":{}}]}
	  ],"children":[]},
	  {"id":"b2","type":"bulletListItem","props":{},"content":[{"type":"text","text":"One","styles":{}}],"children":[]}
	]`
	md, err := RenderMarkdown(doc, RenderOptions{Title: "My page", ResolvePageTitle: func(id string) string { return "Target" }})
	if err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	for _, want := range []string{"# My page", "[Target](noteral-page://pg_2)", "[web](https://example.com)", "- One"} {
		if !strings.Contains(md, want) {
			t.Fatalf("markdown missing %q:\n%s", want, md)
		}
	}
}

func TestParseAcceptsWrappedDocument(t *testing.T) {
	blocks, err := Parse(`{"blocks":[{"id":"b1","type":"paragraph","props":{},"content":[],"children":[]}]}`)
	if err != nil || len(blocks) != 1 {
		t.Fatalf("Parse wrapped: %v %d", err, len(blocks))
	}
}

func TestRenderMarkdownCallout(t *testing.T) {
	doc := `[{"type":"callout","props":{"icon":"💡","tone":"yellow"},"content":[{"type":"text","text":"Remember this"}],"children":[]}]`
	md, err := RenderMarkdown(doc, RenderOptions{})
	if err != nil {
		t.Fatalf("RenderMarkdown: %v", err)
	}
	if !strings.Contains(md, "> 💡 Remember this") {
		t.Fatalf("callout not rendered as a quote: %q", md)
	}
}
