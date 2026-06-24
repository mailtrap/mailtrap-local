package htmlcheck

import (
	"strings"

	"github.com/antchfx/htmlquery"
	"github.com/antchfx/xpath"
	"golang.org/x/net/html"
)

// match is a (line, rule) tuple emitted during validation.
type match struct {
	line int
	rule *Rule
}

// validate runs every rule against the parsed HTML doc and returns the
// aggregated matches.
//
// The HTML body is auto-wrapped by the parser with <html><head><body>
// when missing. We special-case the "<body> element" rule to only fire
// when the source HTML actually contains a <body> tag — otherwise the
// rule would always match because of the auto-injected wrapper.
func validate(htmlBody string, cfg *loaded) []match {
	doc, err := htmlquery.Parse(strings.NewReader(htmlBody))
	if err != nil {
		return nil
	}
	var matches []match

	// HTML rules — XPath against the parsed doc.
	for _, hr := range cfg.htmlRules {
		nav := htmlquery.CreateXPathNavigator(doc)
		iter := hr.xpath.Select(nav)
		for iter.MoveNext() {
			nav, ok := iter.Current().(*htmlquery.NodeNavigator)
			if !ok {
				continue
			}
			node := nav.Current()
			matches = append(matches, match{line: lineOf(node), rule: hr.rule})
		}
	}

	// CSS rules from inline `style="..."` attributes. <style> tag
	// parsing is intentionally deferred — most modern email is inline.
	for _, node := range htmlquery.Find(doc, "//*[@style]") {
		styleAttr := htmlquery.SelectAttr(node, "style")
		decls := parseInlineDeclarations(styleAttr)
		for _, d := range decls {
			matches = append(matches, applyCSSRules(d, lineOf(node), cfg)...)
		}
	}

	// Skip the synthetic <body> rule when the source didn't include
	// one — html parser adds <body> implicitly when missing.
	if !sourceHasBody(htmlBody) {
		filtered := matches[:0]
		for _, m := range matches {
			if m.rule.Title == "<body> element" {
				continue
			}
			filtered = append(filtered, m)
		}
		matches = filtered
	}

	return matches
}

// declaration is a single (property, value) pair from a style="..." block.
type declaration struct {
	prop  string
	value string
}

// parseInlineDeclarations splits a style-attribute value into typed
// declarations. Doesn't try to be a full CSS parser — splits on `;`,
// then on the first `:`. Trims whitespace. Comments and quoted strings
// containing `;` would confuse this; in practice, inline style attrs
// don't have those.
func parseInlineDeclarations(s string) []declaration {
	parts := strings.Split(s, ";")
	out := make([]declaration, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		before, after, ok := strings.Cut(p, ":")
		if !ok {
			continue
		}
		prop := strings.ToLower(strings.TrimSpace(before))
		val := strings.TrimSpace(after)
		out = append(out, declaration{prop: prop, value: val})
	}
	return out
}

// applyCSSRules returns matches for a single (prop, value) declaration
// against the rule sets that operate on declarations:
//   - exact property name (`parser_type: css`)
//   - exact "prop:value" string (`parser_type: css_prop_value`)
//   - regex over the value (`parser_type: css_regexp_value`)
func applyCSSRules(d declaration, line int, cfg *loaded) []match {
	var out []match
	if r, ok := cfg.cssProperty[d.prop]; ok {
		out = append(out, match{line: line, rule: r})
	}
	for _, r := range cfg.cssPropToValue {
		// parser_key shape: "display:flex"
		idx := strings.Index(r.ParserKey, ":")
		if idx < 0 {
			continue
		}
		wantProp := strings.ToLower(strings.TrimSpace(r.ParserKey[:idx]))
		wantVal := strings.TrimSpace(r.ParserKey[idx+1:])
		if d.prop == wantProp && d.value == wantVal {
			out = append(out, match{line: line, rule: r})
		}
	}
	for _, rr := range cfg.cssRegexValue {
		if rr.re.MatchString(d.value) {
			out = append(out, match{line: line, rule: rr.rule})
		}
	}
	return out
}

// lineOf returns the source line number of an html.Node. golang.org/x/net/html
// doesn't track line numbers, so we approximate with 1 — enough for
// the API contract (the SPA shows error_lines as "this rule fires
// on N nodes", precise line numbers aren't surfaced today).
//
// TODO: when line numbers matter, swap to a parser that tracks them
// (e.g. goquery + a custom tokenizer).
func lineOf(_ *html.Node) int { return 1 }

// sourceHasBody returns true if the raw HTML source actually contains
// a `<body` tag (open, possibly with attributes). Used to suppress the
// "<body> element" rule when the auto-injected wrapper is the only
// `<body>` in the parse tree.
func sourceHasBody(s string) bool {
	lower := strings.ToLower(s)
	idx := strings.Index(lower, "<body")
	if idx < 0 {
		return false
	}
	// Make sure the next char is whitespace, > or end — not a longer
	// tag like "<bodyish>".
	next := idx + len("<body")
	if next >= len(lower) {
		return true
	}
	c := lower[next]
	return c == '>' || c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '/'
}

// silence unused-imports when iterating during dev
var _ = xpath.Compile
