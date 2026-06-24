package htmlcheck

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEmptyBody — short-circuits to "no_html".
func TestEmptyBody(t *testing.T) {
	t.Parallel()
	r := Run("")
	assert.Equal(t, "no_html", r.Status)
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
	require.Equal(t, "success", r.Status)

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
		assert.True(t, titles[want], "missing %q; got %v", want, keysOf(titles))
	}

	// Each issue should be decorated with display_name + family_group.
	for _, issue := range r.Issues {
		if len(issue.Clients) == 0 {
			assert.Fail(t, "issue %q has no clients", issue.RuleName)
			continue
		}
		c := issue.Clients[0]
		assert.NotEmpty(t, c.DisplayName)
		assert.NotEmpty(t, c.FamilyGroup)
	}
}

// TestFamiliesShape — every report has the 5 main-share families.
func TestFamiliesShape(t *testing.T) {
	t.Parallel()
	r := Run("<html><body><p>hi</p></body></html>")
	require.Equal(t, "success", r.Status)
	assert.Len(t, r.Families, 5)
	wantFamilies := map[string]bool{
		"apple-mail": true, "gmail": true, "outlook": true,
		"yahoo": true, "other": true,
	}
	for _, f := range r.Families {
		assert.True(t, wantFamilies[f.Family])
		assert.Positive(t, f.MarketShare)
	}
}

// TestBodyRuleSuppressed — "<body> element" rule fires only when the
// source HTML actually contains <body>. golang.org/x/net/html parser
// adds one when missing, so we have to filter post-hoc.
func TestBodyRuleSuppressed(t *testing.T) {
	t.Parallel()
	r := Run("<p>no body tag here</p>")
	for _, issue := range r.Issues {
		assert.NotEqual(t, "<body> element", issue.RuleName)
	}
}

// TestMarketSupportPercent — non-zero, in [0,100].
func TestMarketSupportPercent(t *testing.T) {
	t.Parallel()
	body := `<html><body><div style="accent-color: red;">x</div></body></html>`
	r := Run(body)
	require.Equal(t, "success", r.Status)
	assert.GreaterOrEqual(t, r.MarketSupportPercent, 0.0)
	assert.LessOrEqual(t, r.MarketSupportPercent, 100.0)
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
