# Season outlooks

A season outlook is a versioned research object, never a standing. Source of
truth: `premierLeague2026Baseline` (`src/lib/sports/prediction/seasonOutlooks.ts`),
rendered at `/season-outlooks`.

## Version envelope (every outlook carries all of these)

competition + season (`competition`, `targetSeason`) · evidence cutoff
(`sourceAsOf`, `evidenceCheckedAt`) · source receipts (`officialSources`, each
with a checked-at date) · model version (`model`) · simulation count
(`simulations`) · **included factors** (`includedFactors`) · **missing
factors** (`missingFactors`) · **next revision trigger**
(`nextRevisionTrigger`) · publication date (`publishedAt`) · revision +
**correction history** (`revision`, `previousRevision`, `correctionHistory`
with one entry per revision, newest first, leading with the current one).

When transfers, managers, promoted teams or schedules are omitted, the
missing-factors list and the schedule/transfer/manager state paragraphs say so
explicitly, and the page states the output is not final.

## Promoted teams — structural treatment

`structuralTreatment: "returning-team-baseline"`: the three promoted clubs are
held **outside** the probability field as a separate research object, and the
complete league ranking is **withheld** until calibrated Championship strength
exists (the second of the three allowed treatments: model them / separate
returning-team baseline / withhold the complete ranking). The page names the
excluded clubs and links the official table as the separate verified surface.

## Separation from official standings

The outlook page links `/predictions/league/premier-league/table`; the hub
links the outlook back as "a research object, kept apart from the official
table". `assertTablesSeparate` (tableState) guards the general rule that no
simulated point enters an official table. Determinism: the simulation is
seeded, so revisions change only when inputs change.

Tests: `src/test/season-outlooks.test.ts` (determinism, provenance, factors,
structural treatment, correction history, official-table link + withheld
ranking).
