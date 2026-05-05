package htmlcheck

import (
	"sort"
)

// Run is the package entrypoint: HTML body → Report.
//
// Empty body returns {status: "no_html"}; everything else attempts a
// success report. Five-stage pipeline:
//
//   1. Validate — run HTML XPath rules + inline-CSS rules; collect
//      (line, rule) tuples.
//   2. Group — merge multiple matches of the same rule into one Issue
//      with a sorted ErrorLines list.
//   3. Decorate — fill in client display names + family groups.
//   4. Aggregate — compute per-family per-category support %.
//   5. Roll up — market-share-weighted overall %.
func Run(htmlBody string) Report {
	if htmlBody == "" {
		return Report{Status: "no_html"}
	}
	cfg, err := load()
	if err != nil {
		return Report{Status: "error"}
	}

	matches := validate(htmlBody, cfg)
	issues := groupMatches(matches, cfg)
	families := buildFamilyReports(issues, cfg)
	market := marketSupportPercent(families)

	return Report{
		Status:               "success",
		MarketSupportPercent: market,
		Families:             families,
		Issues:               issues,
	}
}

// groupMatches collapses repeated matches of the same rule into one
// Issue with a sorted, deduped error_lines list.
func groupMatches(matches []match, cfg *loaded) []Issue {
	type group struct {
		rule    *Rule
		lineSet map[int]struct{}
	}
	groups := map[string]*group{}
	order := []string{}
	for _, m := range matches {
		g, ok := groups[m.rule.Title]
		if !ok {
			g = &group{rule: m.rule, lineSet: map[int]struct{}{}}
			groups[m.rule.Title] = g
			order = append(order, m.rule.Title)
		}
		g.lineSet[m.line] = struct{}{}
	}

	out := make([]Issue, 0, len(order))
	for _, title := range order {
		g := groups[title]
		lines := make([]int, 0, len(g.lineSet))
		for ln := range g.lineSet {
			lines = append(lines, ln)
		}
		sort.Ints(lines)

		clients := make([]Client, 0, len(g.rule.Clients))
		for _, c := range g.rule.Clients {
			cc := c
			cc.DisplayName = composeDisplayName(c, cfg)
			cc.FamilyGroup = familyGroupFor(c.Family, cfg)
			clients = append(clients, cc)
		}

		issue := Issue{
			RuleName:      g.rule.Title,
			URL:           g.rule.URL,
			ErrorLines:    lines,
			Clients:       clients,
			NumberedNotes: nonNilNotes(g.rule.NumberedNotes),
		}
		out = append(out, issue)
	}
	return out
}

func buildFamilyReports(issues []Issue, cfg *loaded) []FamilyReport {
	mains := mainFamilies(cfg)
	perCat := supportPercents(issues, mains)

	out := make([]FamilyReport, 0, len(mains))
	for _, f := range mains {
		support := perCat[f.family]
		out = append(out, FamilyReport{
			Family:             f.family,
			Label:              f.label,
			MarketShare:        f.marketShare,
			SupportPerCategory: support,
			SupportPercent:     overallFromCategories(support, f.versionCount),
			VersionCounts:      f.versionCount,
		})
	}
	return out
}

// composeDisplayName builds the human-readable client label as
// "<family> <platform>" with both halves looked up in clients.yml.
// Falls back to raw values for unknown keys.
func composeDisplayName(c Client, cfg *loaded) string {
	fam := cfg.familyDisplay[c.Family]
	if fam == "" {
		fam = c.Family
	}
	plat := cfg.platformDisp[c.Platform]
	if plat == "" {
		plat = c.Platform
	}
	if plat == "" {
		return fam
	}
	return fam + " " + plat
}

// familyGroupFor returns `family` for main families, "other" otherwise.
// Mirrors MainFamiliesService.family_group_for.
func familyGroupFor(family string, cfg *loaded) string {
	if _, ok := cfg.marketShare[family]; ok {
		return family
	}
	return otherFamilyName
}

func nonNilNotes(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}
