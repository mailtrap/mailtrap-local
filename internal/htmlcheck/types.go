// Package htmlcheck implements the email-client compatibility report
// served at GET /api/v1/message/{id}/html_check.
//
// Contract: takes an HTML body, returns an HtmlCheckReport with
// per-rule "issues" (lines + affected clients) and per-family support
// statistics weighted by market share.
package htmlcheck

// Versions is the {yes:[], no:[], partial:[]} block on each client.
type Versions struct {
	Yes     []string `json:"yes,omitempty"     yaml:"yes"`
	No      []string `json:"no,omitempty"      yaml:"no"`
	Partial []string `json:"partial,omitempty" yaml:"partial"`
}

// Client is one mail-client/version row inside a rule's clients[]. The
// JSON shape (PascalCase-ish, snake_case keys) is what the SPA's
// HtmlCheckClient interface expects, so it's preserved exactly.
type Client struct {
	Family   string `json:"family"   yaml:"family"`
	Platform string `json:"platform" yaml:"platform"`
	Category string `json:"category" yaml:"category"`
	Support  string `json:"support"  yaml:"support"` // yes | no | partial
	//nolint:tagliatelle // embedded yaml data uses snake_case keys
	NoteNumbers []int    `json:"note_numbers,omitempty" yaml:"note_numbers"`
	Versions    Versions `json:"versions"               yaml:"versions"`

	// Filled in at response time:
	DisplayName string `json:"display_name,omitempty" yaml:"-"`
	FamilyGroup string `json:"family_group,omitempty" yaml:"-"`
}

// Rule is a single entry from html.yml or css.yml. ParserType selects
// the matching strategy; ParserKey is its argument.
type Rule struct {
	Title         string            `yaml:"title"`
	ParserKey     string            `yaml:"parser_key"`  //nolint:tagliatelle // embedded yaml uses snake_case
	ParserType    string            `yaml:"parser_type"` //nolint:tagliatelle // embedded yaml uses snake_case
	URL           string            `yaml:"url"`
	Clients       []Client          `yaml:"clients"`
	NumberedNotes map[string]string `yaml:"numbered_notes"` //nolint:tagliatelle // embedded yaml uses snake_case
}

// Issue is the per-rule report row the API returns. Builds during
// validation; merges multiple matches into one entry per rule.
type Issue struct {
	RuleName      string            `json:"rule_name"`
	URL           string            `json:"url,omitempty"`
	ErrorLines    []int             `json:"error_lines"`
	Clients       []Client          `json:"clients"`
	NumberedNotes map[string]string `json:"numbered_notes"`
}

// FamilyReport mirrors HtmlCheckFamily on the SPA side.
type FamilyReport struct {
	Family             string         `json:"family"`
	Label              string         `json:"label"`
	MarketShare        int            `json:"market_share"`
	SupportPercent     int            `json:"support_percent"`
	SupportPerCategory CategoryCounts `json:"support_per_category"`
	VersionCounts      CategoryCounts `json:"version_counts"`
}

// CategoryCounts is the {desktop, mobile, web} triple used both for
// version counts and per-category support percents.
type CategoryCounts struct {
	Desktop int `json:"desktop"`
	Mobile  int `json:"mobile"`
	Web     int `json:"web"`
}

// Report is the top-level shape returned by Service.Call.
type Report struct {
	Status               string         `json:"status"`
	MarketSupportPercent float64        `json:"market_support_percent"`
	Families             []FamilyReport `json:"families"`
	Issues               []Issue        `json:"issues"`
}

// ---------------------------------------------------------------------
// Parser-type constants — keys the YAML rule files use to declare which
// matcher applies to each rule body.
// ---------------------------------------------------------------------

const (
	parserHTML           = "html"
	parserCSS            = "css"
	parserCSSPropValue   = "css_prop_value"
	parserCSSRegexpValue = "css_regexp_value"
	parserCSSSelector    = "css_selector"
	parserCSSMedia       = "css_media"
	parserCSSSpecialSel  = "css_special_selector"
)

// platformCategories maps a client's `platform` to one of the three
// category buckets the report aggregates over.
var platformCategories = map[string]string{
	"macos":           "desktop",
	"windows":         "desktop",
	"desktop-app":     "desktop",
	"outlook-com":     "web",
	"windows-mail":    "desktop",
	"desktop-webmail": "web",
	"ios":             "mobile",
	"android":         "mobile",
	"mobile-webmail":  "mobile",
}

// otherFamilyName is the bucket every non-main-family client gets
// folded into.
const otherFamilyName = "other"
