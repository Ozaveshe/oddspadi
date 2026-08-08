import { describe, expect, it } from "vitest";
import { analyseLeg, formatDecimalOdds, toDecimalOdds, type CanonicalSelection } from "@/lib/workspace/selection";
import { analyseWorkspace, freezeWorkspace, settleSnapshot } from "@/lib/workspace/analysis";
import { detectCorrelations, resolveCombinationBasis } from "@/lib/workspace/correlation";
import { importWithAdapter, listSupportedImports, oddspadiTextAdapter } from "@/lib/workspace/bookmakerAdapters";
import { addSelection, duplicateWorkspace, isFrozen, removeSelection, type StoredWorkspace } from "@/lib/workspace/store";

/**
 * Bet Workspace contracts.
 *
 * The behaviour under test is mostly restraint: not multiplying correlated
 * legs, not inventing a probability for an unmodelled market, not rewriting a
 * frozen analysis, and not claiming bookmaker support that does not exist.
 */
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function selection(overrides: Partial<CanonicalSelection> = {}): CanonicalSelection {
  return {
    legId: overrides.legId ?? "leg-1",
    fixtureId: "api-football:1",
    marketId: "match_winner",
    selectionId: "home",
    label: "Arsenal to win",
    fixtureLabel: "Arsenal vs Chelsea",
    competition: "Premier League",
    source: "Consensus",
    userOdds: 2.5,
    oddsObservedAt: "2026-08-01T11:00:00.000Z",
    modelProbability: 0.45,
    modelGeneratedAt: "2026-08-01T11:00:00.000Z",
    decisionState: "watch",
    publicationId: null,
    kickoffAt: "2026-08-01T15:00:00.000Z",
    fixtureStatus: "scheduled",
    marketSupported: true,
    modelInterval: null,
    ...overrides
  };
}

describe("single leg", () => {
  it("reports implied probability, fair odds and the model-market difference", () => {
    const leg = analyseLeg(selection(), NOW);
    expect(leg.impliedProbability).toBeCloseTo(0.4, 10);
    expect(leg.modelFairOdds).toBeCloseTo(1 / 0.45, 6);
    expect(leg.modelMarketDifference).toBeCloseTo(0.05, 10);
    expect(leg.diagnostics).toEqual([]);
    expect(leg.usableForCombination).toBe(true);
  });

  it("uses no value language in the leg note", () => {
    const note = analyseLeg(selection(), NOW).note.toLowerCase();
    for (const banned of ["safe", "guaranteed", "sure", "winning slip", "value bet"]) {
      expect(note).not.toContain(banned);
    }
  });

  it("marks an official publication without turning the leg into one", () => {
    const leg = analyseLeg(selection({ publicationId: "pub-1", decisionState: "pick" }), NOW);
    expect(leg.selection.publicationId).toBe("pub-1");
    // The leg is still the user's selection; nothing here writes to a ledger.
    expect(leg.note).toContain("official pick");
  });
});

describe("missing and stale evidence is stated, never substituted", () => {
  it("flags an unsupported market and refuses to combine it", () => {
    const leg = analyseLeg(selection({ marketSupported: false, modelProbability: null }), NOW);
    expect(leg.diagnostics).toContain("unsupported-market");
    expect(leg.modelFairOdds).toBeNull();
    expect(leg.modelMarketDifference).toBeNull();
    expect(leg.usableForCombination).toBe(false);
  });

  it("flags a missing model without inventing a probability", () => {
    const leg = analyseLeg(selection({ modelProbability: null, modelGeneratedAt: null }), NOW);
    expect(leg.diagnostics).toContain("no-model");
    expect(leg.selection.modelProbability).toBeNull();
    expect(leg.note).toContain("No current OddsPadi model");
  });

  it("flags stale odds and a stale model", () => {
    const stale = analyseLeg(
      selection({ oddsObservedAt: "2026-07-30T12:00:00.000Z", modelGeneratedAt: "2026-07-30T12:00:00.000Z" }),
      NOW
    );
    expect(stale.diagnostics).toContain("stale-odds");
    expect(stale.diagnostics).toContain("stale-model");
    expect(stale.usableForCombination).toBe(false);
  });

  it("flags manual entry with no odds timestamp", () => {
    expect(analyseLeg(selection({ oddsObservedAt: null, source: "manual" }), NOW).diagnostics).toContain("no-odds-timestamp");
  });

  it("flags a match that has already started", () => {
    const live = analyseLeg(selection({ fixtureStatus: "live" }), NOW);
    expect(live.diagnostics).toContain("match-started");
    expect(live.note).toContain("pre-match");
  });
});

describe("multi-leg analysis", () => {
  const differentMatch = selection({
    legId: "leg-2",
    fixtureId: "api-football:2",
    fixtureLabel: "Liverpool vs Everton",
    label: "Liverpool to win",
    userOdds: 2,
    modelProbability: 0.55
  });

  it("multiplies only genuinely independent legs", () => {
    const analysis = analyseWorkspace([selection(), differentMatch], NOW);
    expect(analysis.combinationBasis).toBe("independently-modelled");
    expect(analysis.combinedBookmakerOdds).toBeCloseTo(5, 10);
    expect(analysis.combinedModelProbability).toBeCloseTo(0.248, 3);
    // Same competition, same round: a shared-context note is recorded, but a
    // note does not change the combination basis — only warnings and blocks do.
    expect(analysis.correlations).toEqual([
      expect.objectContaining({ kind: "competition-dependency", severity: "note" })
    ]);
  });

  it("keeps cross-competition legs free of findings", () => {
    const analysis = analyseWorkspace(
      [selection(), { ...differentMatch, competition: "La Liga" }],
      NOW
    );
    expect(analysis.correlations).toEqual([]);
    expect(analysis.combinationBasis).toBe("independently-modelled");
  });

  it("shows a range rather than a single false-precision figure", () => {
    const analysis = analyseWorkspace([selection(), differentMatch], NOW);
    expect(analysis.combinedModelRange).not.toBeNull();
    expect(analysis.combinedModelRange!.low).toBeLessThan(analysis.combinedModelProbability!);
    expect(analysis.combinedModelRange!.high).toBeGreaterThan(analysis.combinedModelProbability!);
    // At most three decimal places — the inputs do not support more.
    expect(String(analysis.combinedModelProbability).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("counts unsupported, stale and started legs", () => {
    const analysis = analyseWorkspace(
      [
        selection(),
        selection({ legId: "u", fixtureId: "api-football:3", marketSupported: false, modelProbability: null }),
        selection({ legId: "s", fixtureId: "api-football:4", oddsObservedAt: "2026-07-30T00:00:00.000Z" }),
        selection({ legId: "l", fixtureId: "api-football:5", fixtureStatus: "live" })
      ],
      NOW
    );
    expect(analysis.unsupportedLegCount).toBe(1);
    expect(analysis.staleLegCount).toBe(1);
    expect(analysis.startedLegCount).toBe(1);
    expect(analysis.supportedLegCount).toBe(3);
    expect(analysis.evidenceQuality).toBe("mixed");
  });

  it("withholds a combined model probability when any leg is unusable", () => {
    const analysis = analyseWorkspace([selection(), selection({ legId: "u", fixtureId: "x", modelProbability: null })], NOW);
    expect(analysis.combinationBasis).toBe("combined-unavailable");
    expect(analysis.combinedModelProbability).toBeNull();
    // The bookmaker price is still shown: that part is known.
    expect(analysis.combinedBookmakerOdds).not.toBeNull();
  });
});

describe("correlation is never assumed away", () => {
  it("detects mutually exclusive selections on the same market", () => {
    const analysis = analyseWorkspace(
      [selection(), selection({ legId: "leg-2", selectionId: "away", label: "Chelsea to win" })],
      NOW
    );
    expect(analysis.correlations[0]!.kind).toBe("mutually-exclusive");
    expect(analysis.containsImpossibleCombination).toBe(true);
    expect(analysis.combinedModelProbability).toBeNull();
    expect(analysis.combinationExplanation).toContain("not available");
  });

  it("detects opposing totals that cannot both land", () => {
    const findings = detectCorrelations([
      analyseLeg(selection({ marketId: "over_under_35", selectionId: "over_35", label: "Over 3.5" }), NOW),
      analyseLeg(selection({ legId: "leg-2", marketId: "over_under_25", selectionId: "under_25", label: "Under 2.5" }), NOW)
    ]);
    expect(findings[0]!.kind).toBe("opposing-selections");
    expect(findings[0]!.severity).toBe("blocking");
  });

  it("allows compatible totals but treats them as related, not independent", () => {
    const legs = [
      analyseLeg(selection({ marketId: "over_under_15", selectionId: "over_15", label: "Over 1.5" }), NOW),
      analyseLeg(selection({ legId: "leg-2", marketId: "over_under_45", selectionId: "under_45", label: "Under 4.5" }), NOW)
    ];
    const findings = detectCorrelations(legs);
    expect(findings[0]!.kind).toBe("related-totals");
    expect(findings[0]!.severity).toBe("warning");
  });

  it("flags a duplicated leg rather than compounding it", () => {
    const analysis = analyseWorkspace([selection(), selection({ legId: "leg-2" })], NOW);
    expect(analysis.correlations[0]!.kind).toBe("duplicate-fixture");
    expect(analysis.combinedModelProbability).toBeNull();
  });

  it("uses the joint model where one is approved", () => {
    const legs = [
      analyseLeg(selection({ marketId: "match_winner", selectionId: "home" }), NOW),
      analyseLeg(selection({ legId: "leg-2", marketId: "over_under_25", selectionId: "over_25", label: "Over 2.5" }), NOW)
    ];
    const basis = resolveCombinationBasis(legs, detectCorrelations(legs));
    expect(basis).toBe("correlation-adjusted");
  });

  it("refuses a precise figure for correlated legs with no joint model", () => {
    const legs = [
      analyseLeg(selection({ marketId: "btts", selectionId: "yes", label: "Both teams to score" }), NOW),
      analyseLeg(selection({ legId: "leg-2", marketId: "clean_sheet_home", selectionId: "yes", label: "Arsenal clean sheet" }), NOW)
    ];
    const basis = resolveCombinationBasis(legs, detectCorrelations(legs));
    expect(basis).toBe("correlation-unknown");
    const analysis = analyseWorkspace(legs.map((leg) => leg.selection), NOW);
    expect(analysis.combinedModelProbability).toBeNull();
    expect(analysis.combinationExplanation).toContain("misleading");
  });
});

describe("odds format conversion", () => {
  it("converts the three supported formats and back", () => {
    expect(toDecimalOdds("2.50", "decimal")).toBeCloseTo(2.5, 10);
    expect(toDecimalOdds("3/2", "fractional")).toBeCloseTo(2.5, 10);
    expect(toDecimalOdds("+150", "american")).toBeCloseTo(2.5, 10);
    expect(toDecimalOdds("-200", "american")).toBeCloseTo(1.5, 10);
    expect(formatDecimalOdds(2.5, "fractional")).toBe("3/2");
    expect(formatDecimalOdds(2.5, "american")).toBe("+150");
  });

  it("rejects malformed odds instead of coercing them", () => {
    expect(toDecimalOdds("evens", "fractional")).toBeNull();
    expect(toDecimalOdds("0.5", "decimal")).toBeNull();
    expect(toDecimalOdds("0", "american")).toBeNull();
  });
});

describe("bookmaker import claims only what exists", () => {
  it("lists supported importers with explicit limitations", () => {
    const supported = listSupportedImports();
    expect(supported.length).toBeGreaterThan(0);
    for (const adapter of supported) {
      expect(adapter.limitations.length).toBeGreaterThan(0);
      expect(adapter.supportedMarkets.length).toBeGreaterThan(0);
    }
  });

  it("parses a well-formed slip", () => {
    const result = oddspadiTextAdapter.parse("Arsenal vs Chelsea | Premier League | match_winner | home | 2.5");
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.legs[0]!.homeTeamName).toBe("Arsenal");
    expect(result.legs[0]!.decimalOdds).toBeCloseTo(2.5, 10);
  });

  it("rejects an unknown bookmaker rather than pretending to support it", () => {
    const result = importWithAdapter("some-bookmaker", "anything");
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures[0]!.kind).toBe("unsupported-format");
  });

  it("rejects the whole slip when any line fails, rather than importing part of it", () => {
    const result = oddspadiTextAdapter.parse(
      ["Arsenal vs Chelsea | Premier League | match_winner | home | 2.5", "nonsense line"].join("\n")
    );
    expect(result.status).toBe("rejected");
  });

  it("rejects an unsupported market and an invalid price", () => {
    const market = oddspadiTextAdapter.parse("A vs B | League | asian_handicap | home | 2.0");
    expect(market.status).toBe("rejected");
    if (market.status === "rejected") expect(market.failures[0]!.kind).toBe("unsupported-market");

    const odds = oddspadiTextAdapter.parse("A vs B | League | match_winner | home | 0.4");
    expect(odds.status).toBe("rejected");
    if (odds.status === "rejected") expect(odds.failures[0]!.kind).toBe("invalid-odds");
  });
});

describe("guest workspace and immutable history", () => {
  const workspace: StoredWorkspace = {
    workspaceId: "ws-1",
    name: "Saturday",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    selections: [selection()],
    snapshot: null
  };

  it("adds, removes and replaces legs while open", () => {
    const added = addSelection(workspace, selection({ legId: "leg-2", fixtureId: "api-football:2" }), "2026-08-01T10:00:00.000Z");
    expect(added.selections.length).toBe(2);
    expect(removeSelection(added, "leg-2", "2026-08-01T10:05:00.000Z").selections.length).toBe(1);
  });

  it("replaces rather than duplicates when the same selection is re-added", () => {
    const readded = addSelection(workspace, selection({ legId: "leg-1-refreshed", userOdds: 2.7 }), "2026-08-01T10:00:00.000Z");
    expect(readded.selections.length).toBe(1);
    expect(readded.selections[0]!.userOdds).toBeCloseTo(2.7, 10);
  });

  it("freezes the analysis and refuses further edits", () => {
    const analysis = analyseWorkspace(workspace.selections, NOW);
    const frozen: StoredWorkspace = { ...workspace, snapshot: freezeWorkspace(analysis, "snap-1", "2026-08-01T15:00:00.000Z") };
    expect(isFrozen(frozen)).toBe(true);
    expect(addSelection(frozen, selection({ legId: "late" }), "2026-08-01T16:00:00.000Z").selections.length).toBe(1);
    expect(removeSelection(frozen, "leg-1", "2026-08-01T16:00:00.000Z").selections.length).toBe(1);
  });

  it("keeps the historical model probability after settlement", () => {
    const analysis = analyseWorkspace(workspace.selections, NOW);
    const snapshot = freezeWorkspace(analysis, "snap-1", "2026-08-01T15:00:00.000Z");
    const originalProbability = snapshot.analysis.legs[0]!.selection.modelProbability;

    const settled = settleSnapshot(snapshot, [{ legId: "leg-1", outcome: "won" }], "2026-08-01T17:00:00.000Z");
    expect(settled.settlement?.legOutcomes[0]!.outcome).toBe("won");
    // The result must not rewrite what the model said beforehand.
    expect(settled.analysis.legs[0]!.selection.modelProbability).toBe(originalProbability);
    expect(settled.analysis.legs[0]!.selection.modelGeneratedAt).toBe("2026-08-01T11:00:00.000Z");
  });

  it("keeps a frozen snapshot isolated from later edits to the live workspace", () => {
    const analysis = analyseWorkspace(workspace.selections, NOW);
    const snapshot = freezeWorkspace(analysis, "snap-1", "2026-08-01T15:00:00.000Z");
    analysis.legs[0]!.selection.userOdds = 99;
    expect(snapshot.analysis.legs[0]!.selection.userOdds).toBeCloseTo(2.5, 10);
  });

  it("duplicates a workspace as a fresh, unfrozen analysis", () => {
    const analysis = analyseWorkspace(workspace.selections, NOW);
    const frozen: StoredWorkspace = { ...workspace, snapshot: freezeWorkspace(analysis, "snap-1", "2026-08-01T15:00:00.000Z") };
    const copy = duplicateWorkspace(frozen, "ws-2", "2026-08-02T09:00:00.000Z");
    expect(copy.snapshot).toBeNull();
    expect(isFrozen(copy)).toBe(false);
    expect(copy.selections.length).toBe(1);
  });
});

describe("user selections stay out of the official ledger", () => {
  it("exposes no write path to publications from the workspace modules", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    for (const file of ["selection.ts", "analysis.ts", "correlation.ts", "store.ts", "bookmakerAdapters.ts"]) {
      const source = await readFile(join(process.cwd(), "src", "lib", "workspace", file), "utf8");
      expect(source).not.toContain("op_publications");
      expect(source).not.toContain("op_public_picks");
      expect(source).not.toContain(".insert(");
      expect(source).not.toContain(".upsert(");
    }
  });

  it("produces no staking recommendation", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const analysis = await readFile(join(process.cwd(), "src", "lib", "workspace", "analysis.ts"), "utf8");
    // Look for recommendation-shaped APIs rather than the words themselves:
    // prose that says the workspace produces no stake size is the point, not
    // a violation of it.
    for (const banned of ["recommendedStake", "stakeSize", "kellyFraction", "suggestedStake", "bankroll"]) {
      expect(analysis).not.toContain(banned);
    }
    const workspaceKeys = ["combinedModelProbability", "combinationBasis", "evidenceQuality"];
    for (const key of workspaceKeys) expect(analysis).toContain(key);
  });
});
