package htmlcheck

import (
	"sort"
)

// mainFamily is the data we know per-family without any HTML to scan:
// its market-share weight + version counts in each category.
type mainFamily struct {
	family       string
	label        string
	marketShare  int
	versionCount CategoryCounts
}

// mainFamilies returns the 5-row "headline" family list driven by the
// market-shares config, in the order the YAML declares them.
func mainFamilies(cfg *loaded) []mainFamily {
	// Preserve config iteration order — apple-mail/gmail/outlook/yahoo/other.
	keys := orderedShareKeys(cfg)
	out := make([]mainFamily, 0, len(keys))
	for _, family := range keys {
		label := cfg.familyDisplay[family]
		if family == otherFamilyName {
			label = "Other"
		}
		out = append(out, mainFamily{
			family:       family,
			label:        label,
			marketShare:  cfg.marketShare[family],
			versionCount: aggregateVersionCounts(cfg, family, keys),
		})
	}
	return out
}

// orderedShareKeys returns the market-share config's families in a
// deterministic order — keys are sorted by descending share so iteration
// matches the YAML's intended display order.
func orderedShareKeys(cfg *loaded) []string {
	type kv struct {
		k string
		v int
	}
	all := make([]kv, 0, len(cfg.marketShare))
	for k, v := range cfg.marketShare {
		all = append(all, kv{k, v})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].v != all[j].v {
			return all[i].v > all[j].v
		}
		return all[i].k < all[j].k
	})
	out := make([]string, len(all))
	for i, kv := range all {
		out[i] = kv.k
	}
	return out
}

// aggregateVersionCounts sums the platform-level version counts into
// the desktop/mobile/web category buckets for the given family. For
// the synthetic "other" family, it sums every non-main-family.
func aggregateVersionCounts(cfg *loaded, family string, mainKeys []string) CategoryCounts {
	mainSet := make(map[string]bool, len(mainKeys))
	for _, k := range mainKeys {
		if k != otherFamilyName {
			mainSet[k] = true
		}
	}

	var counts CategoryCounts
	for famName, perPlatform := range cfg.versionCounts {
		// Filter: this row contributes to `family` if (a) it IS family,
		// or (b) family == "other" and famName isn't a main one.
		if family == otherFamilyName {
			if mainSet[famName] {
				continue
			}
		} else if famName != family {
			continue
		}
		for platform, n := range perPlatform {
			cat := platformCategories[platform]
			switch cat {
			case "desktop":
				counts.Desktop += n
			case "mobile":
				counts.Mobile += n
			case "web":
				counts.Web += n
			}
		}
	}
	return counts
}

// supportPercents converts a list of issues into per-family
// per-category percentage drops, then inverts to "support_per_category".
//
// Algorithm:
//
//	for each issue:
//	  for each affected client (where support != "yes"):
//	    for each {status, versions} in client.versions:
//	      family_key = client.family if main else "other"
//	      drop = 100 * len(versions) / total_versions[family_key][category]
//	      aggregated[family_key][rule_name][status][category] += drop
//
// Then for each family, support_per_category[c] = 100 - sum(drops in c).
func supportPercents(
	issues []Issue, families []mainFamily,
) map[string]CategoryCounts {
	mainSet := make(map[string]bool, len(families))
	for _, f := range families {
		mainSet[f.family] = true
	}

	// Collect total version counts per (family, category). We could
	// pull it off `families` but recomputing keeps this self-contained.
	totals := map[string]CategoryCounts{}
	for _, f := range families {
		totals[f.family] = f.versionCount
	}

	// agg[family][rule][status][category] = percent
	agg := map[string]map[string]map[string]map[string]int{}

	for _, issue := range issues {
		for _, c := range issue.Clients {
			if c.Support == "yes" || c.Category == "" {
				continue
			}
			famKey := c.Family
			if !mainSet[famKey] {
				famKey = otherFamilyName
			}
			total := categoryValue(totals[famKey], c.Category)
			if total == 0 {
				continue
			}
			byStatus := map[string][]string{
				"no":      c.Versions.No,
				"partial": c.Versions.Partial,
			}
			for status, versions := range byStatus {
				if len(versions) == 0 {
					continue
				}
				drop := 100 * len(versions) / total
				if agg[famKey] == nil {
					agg[famKey] = map[string]map[string]map[string]int{}
				}
				if agg[famKey][issue.RuleName] == nil {
					agg[famKey][issue.RuleName] = map[string]map[string]int{}
				}
				if agg[famKey][issue.RuleName][status] == nil {
					agg[famKey][issue.RuleName][status] = map[string]int{}
				}
				agg[famKey][issue.RuleName][status][c.Category] += drop
			}
		}
	}

	// Convert to per-family CategoryCounts of *support*.
	out := map[string]CategoryCounts{}
	for _, f := range families {
		out[f.family] = perCategorySupport(agg[f.family])
	}
	return out
}

func categoryValue(c CategoryCounts, cat string) int {
	switch cat {
	case "desktop":
		return c.Desktop
	case "mobile":
		return c.Mobile
	case "web":
		return c.Web
	}
	return 0
}

// perCategorySupport sums every rule's drops in each category and
// inverts. Clamps to [0, 100].
func perCategorySupport(byRule map[string]map[string]map[string]int) CategoryCounts {
	var dDrop, mDrop, wDrop int
	for _, byStatus := range byRule {
		for _, byCategory := range byStatus {
			dDrop += byCategory["desktop"]
			mDrop += byCategory["mobile"]
			wDrop += byCategory["web"]
		}
	}
	return CategoryCounts{
		Desktop: 100 - clampPct(dDrop),
		Mobile:  100 - clampPct(mDrop),
		Web:     100 - clampPct(wDrop),
	}
}

// overallFromCategories weights each category's support % by the
// family's version count in that category.
func overallFromCategories(perCat, counts CategoryCounts) int {
	totalVersions := counts.Desktop + counts.Mobile + counts.Web
	if totalVersions == 0 {
		return 100
	}
	weighted := perCat.Desktop*counts.Desktop +
		perCat.Mobile*counts.Mobile +
		perCat.Web*counts.Web
	return weighted / totalVersions
}

// marketSupportPercent is the share-weighted average of family
// support_percent across all main families. Frontend recomputes this
// when filters change; this is the all-on baseline.
func marketSupportPercent(families []FamilyReport) float64 {
	totalShare := 0
	for _, f := range families {
		totalShare += f.MarketShare
	}
	if totalShare == 0 {
		return 100
	}
	weighted := 0
	for _, f := range families {
		weighted += f.SupportPercent * f.MarketShare
	}
	return roundOne(float64(weighted) / float64(totalShare))
}

func clampPct(n int) int {
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func roundOne(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}
