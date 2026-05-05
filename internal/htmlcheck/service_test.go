package htmlcheck

import (
	"strings"
	"testing"
)

// TestEmptyBody — short-circuits to "no_html".
func TestEmptyBody(t *testing.T) {
	t.Parallel()
	r := Run("")
	if r.Status != "no_html" {
		t.Errorf("status = %q, want no_html", r.Status)
	}
}

// TestKnownBadHTML — fires several real rules.
//
// `<abbr>`, `<audio>`, `accent-color`, and `display:flex` are all in
// the caniemail data with at least one client reporting "no" support,
// so they should each produce an Issue.
func TestKnownBadHTML(t *testing.T) {
	t.Parallel()
	body := `
<html>
<body>
  <abbr title="hi">x</abbr>
  <audio src="x.mp3"></audio>
  <div style="accent-color: red; display: flex;">flex</div>
</body>
</html>`
	r := Run(body)
	if r.Status != "success" {
		t.Fatalf("status = %q, want success", r.Status)
	}

	titles := map[string]bool{}
	for _, issue := range r.Issues {
		titles[issue.RuleName] = true
	}

	for _, want := range []string{
		"<abbr> element",
		"<audio> element",
		"accent-color",
		"display:flex",
	} {
		if !titles[want] {
			t.Errorf("missing rule %q in report; got %v", want, keysOf(titles))
		}
	}

	// Each issue should be decorated with display_name + family_group.
	for _, issue := range r.Issues {
		if len(issue.Clients) == 0 {
			t.Errorf("issue %q has no clients", issue.RuleName)
			continue
		}
		c := issue.Clients[0]
		if c.DisplayName == "" {
			t.Errorf("issue %q client[0].DisplayName empty", issue.RuleName)
		}
		if c.FamilyGroup == "" {
			t.Errorf("issue %q client[0].FamilyGroup empty", issue.RuleName)
		}
	}
}

// TestFamiliesShape — every report has the 5 main-share families.
func TestFamiliesShape(t *testing.T) {
	t.Parallel()
	r := Run("<html><body><p>hi</p></body></html>")
	if r.Status != "success" {
		t.Fatalf("status = %q", r.Status)
	}
	if len(r.Families) != 5 {
		t.Errorf("families count = %d, want 5", len(r.Families))
	}
	wantFamilies := map[string]bool{
		"apple-mail": true, "gmail": true, "outlook": true,
		"yahoo": true, "other": true,
	}
	for _, f := range r.Families {
		if !wantFamilies[f.Family] {
			t.Errorf("unexpected family in report: %s", f.Family)
		}
		if f.MarketShare <= 0 {
			t.Errorf("family %s has zero market_share", f.Family)
		}
	}
}

// TestBodyRuleSuppressed — "<body> element" rule fires only when the
// source HTML actually contains <body>. golang.org/x/net/html parser
// adds one when missing, so we have to filter post-hoc.
func TestBodyRuleSuppressed(t *testing.T) {
	t.Parallel()
	r := Run("<p>no body tag here</p>")
	for _, issue := range r.Issues {
		if issue.RuleName == "<body> element" {
			t.Errorf("body rule fired despite source having no <body>")
		}
	}
}

// TestMarketSupportPercent — non-zero, in [0,100].
func TestMarketSupportPercent(t *testing.T) {
	t.Parallel()
	body := `<html><body><div style="accent-color: red;">x</div></body></html>`
	r := Run(body)
	if r.Status != "success" {
		t.Fatal("status")
	}
	if r.MarketSupportPercent < 0 || r.MarketSupportPercent > 100 {
		t.Errorf("market_support_percent = %v out of [0,100]", r.MarketSupportPercent)
	}
}

func keysOf(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

// guard against accidentally importing strings only in test
var _ = strings.HasPrefix
