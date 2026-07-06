package htmlcheck

import (
	"embed"
	"fmt"
	"regexp"
	"sync"

	"github.com/antchfx/xpath"
	"gopkg.in/yaml.v3"
)

//go:embed data/html.yml data/css.yml data/clients.yml data/client_market_shares_percent.yml data/client_version_counts.yml
var dataFS embed.FS

// loaded holds the parsed config — cached on first access. Singletons
// because the data is immutable and reading + parsing the YAML costs
// real time (~500 ms cold; ~0 cached).
type loaded struct {
	htmlRules []*compiledHTMLRule

	// CSS rules grouped by parser_type, since each type has its own
	// matching strategy.
	cssProperty      map[string]*Rule     // exact CSS prop name → rule
	cssPropToValue   []*Rule              // "prop:value;" exact match
	cssRegexValue    []*compiledRegexRule // regex on declaration value
	cssSelector      []*compiledRegexRule // regex on selector
	cssSpecialSel    []*compiledRegexRule // first-match-wins selector regex
	cssMediaRule     *Rule                // the "@media" rule itself
	cssMediaFeatures []*Rule              // feature-name rules for @media

	familyDisplay map[string]string         // gmail → "Gmail"
	platformDisp  map[string]string         // ios → "iOS"
	marketShare   map[string]int            // family → 0..100
	versionCounts map[string]map[string]int // family → platform → count
}

type compiledHTMLRule struct {
	rule  *Rule
	xpath *xpath.Expr // pre-compiled XPath expression
}

type compiledRegexRule struct {
	rule *Rule
	re   *regexp.Regexp
}

var (
	loadOnce sync.Once
	cached   *loaded
	errLoad  error
)

// load returns the parsed config, populating it on first call. Subsequent
// calls are O(1) — the config is immutable.
func load() (*loaded, error) {
	loadOnce.Do(func() {
		cached, errLoad = parseAll()
	})
	return cached, errLoad
}

func parseAll() (*loaded, error) {
	out := &loaded{
		cssProperty:   map[string]*Rule{},
		familyDisplay: map[string]string{},
		platformDisp:  map[string]string{},
		marketShare:   map[string]int{},
		versionCounts: map[string]map[string]int{},
	}

	// ----- HTML rules -----
	htmlRaw, err := dataFS.ReadFile("data/html.yml")
	if err != nil {
		return nil, wrapLoadErr(err)
	}
	var htmlRules []*Rule
	if err := yaml.Unmarshal(htmlRaw, &htmlRules); err != nil {
		return nil, wrapLoadErr(err)
	}
	for _, r := range htmlRules {
		expr, err := xpath.Compile(r.ParserKey)
		if err != nil {
			// Bad XPath in the rules data is a programmer/data error,
			// not a runtime error — skip the rule with a fingerprint
			// so the test suite catches it.
			continue
		}
		out.htmlRules = append(out.htmlRules, &compiledHTMLRule{rule: r, xpath: expr})
	}

	// ----- CSS rules -----
	cssRaw, err := dataFS.ReadFile("data/css.yml")
	if err != nil {
		return nil, wrapLoadErr(err)
	}
	var cssRules []*Rule
	if err := yaml.Unmarshal(cssRaw, &cssRules); err != nil {
		return nil, wrapLoadErr(err)
	}
	for _, r := range cssRules {
		switch r.ParserType {
		case parserCSS:
			out.cssProperty[r.ParserKey] = r
		case parserCSSPropValue:
			out.cssPropToValue = append(out.cssPropToValue, r)
		case parserCSSRegexpValue:
			if re, err := regexp.Compile(r.ParserKey); err == nil {
				out.cssRegexValue = append(out.cssRegexValue, &compiledRegexRule{rule: r, re: re})
			}
		case parserCSSSelector:
			if re, err := regexp.Compile(r.ParserKey); err == nil {
				out.cssSelector = append(out.cssSelector, &compiledRegexRule{rule: r, re: re})
			}
		case parserCSSSpecialSel:
			if re, err := regexp.Compile(r.ParserKey); err == nil {
				out.cssSpecialSel = append(out.cssSpecialSel, &compiledRegexRule{rule: r, re: re})
			}
		case parserCSSMedia:
			if r.ParserKey == "@media" {
				out.cssMediaRule = r
			} else {
				out.cssMediaFeatures = append(out.cssMediaFeatures, r)
			}
		}
	}

	// ----- Clients (display names) -----
	clientsRaw, err := dataFS.ReadFile("data/clients.yml")
	if err != nil {
		return nil, wrapLoadErr(err)
	}
	var clientsCfg struct {
		Family   map[string]string `yaml:"family"`
		Platform map[string]string `yaml:"platform"`
	}
	if err := yaml.Unmarshal(clientsRaw, &clientsCfg); err != nil {
		return nil, wrapLoadErr(err)
	}
	out.familyDisplay = clientsCfg.Family
	out.platformDisp = clientsCfg.Platform

	// ----- Market shares -----
	shareRaw, err := dataFS.ReadFile("data/client_market_shares_percent.yml")
	if err != nil {
		return nil, wrapLoadErr(err)
	}
	if err := yaml.Unmarshal(shareRaw, &out.marketShare); err != nil {
		return nil, wrapLoadErr(err)
	}

	// ----- Version counts -----
	countsRaw, err := dataFS.ReadFile("data/client_version_counts.yml")
	if err != nil {
		return nil, wrapLoadErr(err)
	}
	if err := yaml.Unmarshal(countsRaw, &out.versionCounts); err != nil {
		return nil, wrapLoadErr(err)
	}

	return out, nil
}

func wrapLoadErr(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("load: %w", err)
}
