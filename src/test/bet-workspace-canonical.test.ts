import { describe, expect, it } from "vitest";
import { analyseLeg, type CanonicalSelection } from "@/lib/workspace/selection";
import { analyseWorkspace } from "@/lib/workspace/analysis";
import { holdUnresolvedText, resolveStructuredLeg, type StructuredLegInput } from "@/lib/workspace/resolve";
import { gradePersonalLeg, gradePersonalLegs, combinePersonalOutcomes, PERSONAL_RECORD_COPY } from "@/lib/workspace/personalSettlement";
import { platformViewForLeg } from "@/lib/workspace/platformView";
import { archiveWorkspace, exportWorkspace, renameWorkspace, type StoredWorkspace } from "@/lib/workspace/store";
import { emptyResult, type CanonicalResult } from "@/lib/results/canonicalResult";
import { ODDSPADI_TEXT_TARGET } from "@/lib/markets/conversion";
import type { MarketAlias } from "@/lib/markets/alias";
import { signShareToken, verifyShareToken } from "@/lib/workspaceSync/shareToken";
import { isSyncableWorkspace, sanitizeForShare } from "@/lib/workspaceSync/sanitize";

/**
 * Bet Workspace v2 contracts: canonical resolution, the extended leg output,
 * personal settlement through the official grader, platform conversion, and
 * the privacy boundary on shares.
 */
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function structuredInput(overrides: Partial<StructuredLegInput> = {}): StructuredLegInput {
  return {
    fixtureId: "api-football:10",
    sport: "football",
    marketId: "match_winner",
    selectionId: "home",
    label: "Arsenal to win",
    fixtureLabel: "Arsenal vs Chelsea",
    competition: "Premier League",
    source: "Bet365",
    entryPoint: "today",
    userOdds: 2.1,
    oddsObservedAt: "2026-08-01T11:00:00.000Z",
    marketNoVigProbability: 0.46,
    modelProbability: 0.48,
    modelGeneratedAt: "2026-08-01T11:00:00.000Z",
    decisionState: "watch",
    publicationId: null,
    kickoffAt: "2026-08-01T15:00:00.000Z",
    fixtureStatus: "scheduled",
    marketSupported: true,
    modelInterval: { low: 0.44, high: 0.52 },
    ...overrides
  };
}

function resolvedSelection(overrides: Partial<StructuredLegInput> = {}, legId = "leg-1"): CanonicalSelection {
  const result = resolveStructuredLeg(structuredInput(overrides), legId);
  if (result.kind !== "leg") throw new Error(`expected leg, got ${JSON.stringify(result)}`);
  return result.selection;
}

describe("canonical resolution at add time", () => {
  it("derives the canonical selection key through the settlement bridge", () => {
    expect(resolvedSelection().canonicalSelectionKey).toBe("football.1x2.regulation.home");
    expect(resolvedSelection({ marketId: "over_under_25", selectionId: "over" }).canonicalSelectionKey).toBe(
      "football.total_goals.regulation.over.2_5"
    );
  });

  it("carries a null key for unmapped markets instead of guessing", () => {
    const selection = resolvedSelection({ marketId: "first_goalscorer", selectionId: "saka" });
    expect(selection.canonicalSelectionKey).toBeNull();
    // Still carried, still priced — just excluded from canonical operations.
    expect(selection.userOdds).toBeCloseTo(2.1, 10);
  });

  it("records the entry point as a closed vocabulary", () => {
    expect(resolvedSelection({ entryPoint: "official_publication" }).entryPoint).toBe("official_publication");
  });

  it("rejects structurally broken input with a stated reason", () => {
    const noOdds = resolveStructuredLeg(structuredInput({ userOdds: 1 }), "leg-x");
    expect(noOdds.kind).toBe("rejected");
    const noKickoff = resolveStructuredLeg(structuredInput({ kickoffAt: "not-a-date" }), "leg-x");
    expect(noKickoff.kind).toBe("rejected");
  });

  it("holds free text as an unresolved note, never as an analysable leg", () => {
    const entry = holdUnresolvedText("  Arsenal to win @ 1.8  ", "note-1", "2026-08-01T12:00:00.000Z");
    expect(entry.text).toBe("Arsenal to win @ 1.8");
    expect(entry.reason).toContain("not part of the analysis");
    // The type system already keeps it out of analyseWorkspace; assert the
    // shape carries no odds or probability fields to smuggle in.
    expect("userOdds" in entry).toBe(false);
    expect("modelProbability" in entry).toBe(false);
  });
});

describe("extended leg output", () => {
  it("reports no-vig, conservative, fair odds, edge, EV and uncertainty", () => {
    const leg = analyseLeg(resolvedSelection(), NOW);
    expect(leg.noVigProbability).toBeCloseTo(0.46, 10);
    expect(leg.conservativeProbability).toBeCloseTo(0.44, 10);
    expect(leg.modelFairOdds).toBeCloseTo(1 / 0.48, 6);
    expect(leg.modelMarketDifference).toBeCloseTo(0.48 - 1 / 2.1, 10);
    expect(leg.expectedValue).toBeCloseTo(0.48 * 2.1 - 1, 10);
    expect(leg.uncertaintyWidth).toBeCloseTo(0.08, 10);
    expect(leg.isOfficialPick).toBe(false);
  });

  it("falls back to min(model, market) for conservative when no interval exists", () => {
    const leg = analyseLeg(resolvedSelection({ modelInterval: null }), NOW);
    expect(leg.conservativeProbability).toBeCloseTo(0.46, 10);
    expect(leg.uncertaintyWidth).toBeNull();
  });

  it("gives no conservative number when neither model nor market exists", () => {
    const leg = analyseLeg(
      resolvedSelection({ modelProbability: null, modelGeneratedAt: null, marketNoVigProbability: null, modelInterval: null }),
      NOW
    );
    expect(leg.conservativeProbability).toBeNull();
    expect(leg.expectedValue).toBeNull();
  });
});

describe("accumulator market chance", () => {
  const first = resolvedSelection({}, "leg-1");
  const second = resolvedSelection(
    { fixtureId: "api-football:11", fixtureLabel: "Leeds vs Villa", competition: "La Liga", marketNoVigProbability: 0.5 },
    "leg-2"
  );

  it("multiplies de-vigged probabilities alongside the naive implied chance", () => {
    const analysis = analyseWorkspace([first, second], NOW);
    expect(analysis.deViggedMarketProbability).toBeCloseTo(0.46 * 0.5, 3);
    expect(analysis.naiveImpliedProbability).toBeCloseTo(1 / (2.1 * 2.1), 3);
  });

  it("withholds the market chance when a leg lacks a de-vigged view", () => {
    const manual = resolvedSelection({ fixtureId: "api-football:12", marketNoVigProbability: null }, "leg-3");
    expect(analyseWorkspace([first, manual], NOW).deViggedMarketProbability).toBeNull();
  });

  it("withholds every combined number over an impossible pair", () => {
    const contradiction = resolvedSelection({ selectionId: "away", label: "Chelsea to win" }, "leg-4");
    const analysis = analyseWorkspace([first, contradiction], NOW);
    expect(analysis.containsImpossibleCombination).toBe(true);
    expect(analysis.deViggedMarketProbability).toBeNull();
    expect(analysis.combinedModelProbability).toBeNull();
  });

  it("flags the same event listed under two ids as a duplicate, not two legs", () => {
    const crossListed = resolvedSelection({ fixtureId: "flashscore:988" }, "leg-5");
    const analysis = analyseWorkspace([first, crossListed], NOW);
    expect(analysis.correlations.some((finding) => finding.kind === "duplicate-fixture" && finding.severity === "blocking")).toBe(true);
  });
});

describe("personal settlement through the official grader", () => {
  function verifiedResult(home: number, away: number): CanonicalResult {
    return {
      ...emptyResult("api-football:10", "football"),
      regulationHome: home,
      regulationAway: away,
      winner: home > away ? "home" : home < away ? "away" : "draw",
      winnerBasis: "regulation",
      verificationState: "verified"
    };
  }

  it("settles a won leg with the accumulator return multiple", () => {
    const settlement = gradePersonalLeg(resolvedSelection(), verifiedResult(2, 0));
    expect(settlement.outcome).toBe("won");
    expect(settlement.returnMultiple).toBeCloseTo(1.1, 10);
  });

  it("half-settles an Asian quarter line exactly as the official ledger would", () => {
    const quarter = resolvedSelection(
      { marketId: "asian_handicap", selectionId: "home", marketLine: -0.25, userOdds: 2.0 },
      "leg-ah"
    );
    expect(quarter.canonicalSelectionKey).toBe("football.asian_handicap.regulation.home.-0_25");
    const settlement = gradePersonalLeg(quarter, verifiedResult(1, 1));
    expect(settlement.outcome).toBe("half_lost");
    expect(settlement.returnMultiple).toBe(-0.5);
  });

  it("declines to grade a leg without a canonical key", () => {
    const unmapped = resolvedSelection({ marketId: "first_goalscorer", selectionId: "saka" }, "leg-fg");
    const settlement = gradePersonalLeg(unmapped, verifiedResult(2, 0));
    expect(settlement.outcome).toBe("needs_review");
    expect(settlement.returnMultiple).toBeNull();
  });

  it("keeps unresolved fixtures pending and combines with accumulator rules", () => {
    const legs = [resolvedSelection({}, "leg-a"), resolvedSelection({ fixtureId: "api-football:99" }, "leg-b")];
    const settlements = gradePersonalLegs(legs, new Map([["api-football:10", verifiedResult(2, 0)]]));
    expect(settlements[0]!.outcome).toBe("won");
    expect(settlements[1]!.outcome).toBe("pending");
    expect(combinePersonalOutcomes(settlements).outcome).toBe("pending");
    // A lost leg settles the combination regardless of what else is open.
    const withLoss = [...settlements, { legId: "leg-c", outcome: "lost" as const, returnMultiple: -1, detail: "" }];
    expect(combinePersonalOutcomes(withLoss).outcome).toBe("lost");
  });

  it("labels the personal record as personal, in one shared sentence", () => {
    expect(PERSONAL_RECORD_COPY).toContain("not part of the official OddsPadi track record");
  });
});

describe("platform conversion for legs", () => {
  const alias: MarketAlias = {
    aliasId: "alias-1",
    provider: "oddspadi-text",
    sourceSport: "football",
    rawMarket: "Match winner",
    rawSelection: "Home",
    rawLine: null,
    canonicalMarketKey: "football.1x2.regulation",
    canonicalSelectionKey: "football.1x2.regulation.home",
    mappingState: "exact_equivalent",
    participantOrder: "home_away",
    conditions: [],
    status: "active",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    version: 1,
    supersedesAliasId: null,
    evidence: [],
    reviewedBy: "test",
    reviewedAt: "2026-01-01T00:00:00.000Z"
  } as unknown as MarketAlias;

  it("names the platform label for a mapped leg", () => {
    const view = platformViewForLeg(resolvedSelection(), ODDSPADI_TEXT_TARGET, [alias], "2026-08-01T00:00:00.000Z");
    expect(view.result.status).toBe("exact");
    expect(view.summary).toContain("Match winner");
  });

  it("says why when the leg has no canonical key, without guessing a label", () => {
    const view = platformViewForLeg(
      resolvedSelection({ marketId: "first_goalscorer", selectionId: "saka" }),
      ODDSPADI_TEXT_TARGET,
      [alias],
      "2026-08-01T00:00:00.000Z"
    );
    expect(view.result.status).toBe("unavailable");
    expect(view.summary).toContain("No platform equivalent");
  });

  it("reports an unsupported market as the platform's gap, not a workspace error", () => {
    const handicap = resolvedSelection({ marketId: "asian_handicap", selectionId: "home", marketLine: -1 }, "leg-ah2");
    const view = platformViewForLeg(handicap, ODDSPADI_TEXT_TARGET, [alias], "2026-08-01T00:00:00.000Z");
    expect(view.result.status).toBe("unsupported");
  });
});

describe("workspace actions", () => {
  const base: StoredWorkspace = {
    workspaceId: "ws-1",
    name: "Weekend analysis",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    selections: [resolvedSelection()],
    snapshot: null,
    archivedAt: null
  };

  it("renames within bounds and refuses an empty name", () => {
    expect(renameWorkspace(base, "  Midweek  ", "2026-08-01T11:00:00.000Z").name).toBe("Midweek");
    expect(renameWorkspace(base, "   ", "2026-08-01T11:00:00.000Z").name).toBe("Weekend analysis");
  });

  it("archives without deleting anything", () => {
    const archived = archiveWorkspace(base, "2026-08-01T11:00:00.000Z");
    expect(archived.archivedAt).toBe("2026-08-01T11:00:00.000Z");
    expect(archived.selections).toHaveLength(1);
  });

  it("exports a readable self-describing document", () => {
    const parsed = JSON.parse(exportWorkspace(base, "2026-08-01T11:00:00.000Z")) as { format: string; workspace: StoredWorkspace };
    expect(parsed.format).toBe("oddspadi-workspace-export-v1");
    expect(parsed.workspace.selections[0]!.canonicalSelectionKey).toBe("football.1x2.regulation.home");
  });
});

describe("share tokens", () => {
  const SECRET = "test-secret-at-least-sixteen-chars";
  const shareId = "0b6f9c2e-1111-2222-3333-444455556666";

  it("round-trips a valid token", () => {
    const expires = NOW + 60_000;
    const verdict = verifyShareToken(signShareToken(shareId, expires, SECRET), SECRET, NOW);
    expect(verdict).toEqual({ ok: true, shareId, expiresAtMs: expires });
  });

  it("rejects an expired token", () => {
    const verdict = verifyShareToken(signShareToken(shareId, NOW - 1, SECRET), SECRET, NOW);
    expect(verdict).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token whose expiry was tampered with", () => {
    const token = signShareToken(shareId, NOW + 60_000, SECRET);
    const [id, , signature] = token.split(".");
    const verdict = verifyShareToken(`${id}.${NOW + 999_999_999}.${signature}`, SECRET, NOW);
    expect(verdict).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token signed with a different secret", () => {
    const forged = signShareToken(shareId, NOW + 60_000, "attacker-controlled-secret!");
    expect(verifyShareToken(forged, SECRET, NOW).ok).toBe(false);
  });
});

describe("share sanitisation", () => {
  const workspace: StoredWorkspace = {
    workspaceId: "ws-1",
    name: "  Weekend analysis  ",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    selections: [resolvedSelection()],
    unresolvedEntries: [holdUnresolvedText("my private shortlist note", "note-1", "2026-08-01T10:00:00.000Z")],
    snapshot: null,
    archivedAt: null,
    share: { token: "should-never-leak.123.abc", expiresAt: "2026-08-08T00:00:00.000Z" }
  };

  it("strips free-text notes and prior share tokens from the shared payload", () => {
    const shared = sanitizeForShare(workspace, "2026-08-01T12:00:00.000Z");
    const serialised = JSON.stringify(shared);
    expect(serialised).not.toContain("my private shortlist note");
    expect(serialised).not.toContain("should-never-leak");
    expect(serialised).not.toContain("workspaceId");
    expect(shared.name).toBe("Weekend analysis");
    expect(shared.selections).toHaveLength(1);
  });

  it("validates sync payloads structurally and rejects the rest", () => {
    expect(isSyncableWorkspace(workspace)).toBe(true);
    expect(isSyncableWorkspace({ ...workspace, selections: "not-an-array" })).toBe(false);
    expect(isSyncableWorkspace({ ...workspace, workspaceId: "" })).toBe(false);
    expect(isSyncableWorkspace(null)).toBe(false);
  });
});
