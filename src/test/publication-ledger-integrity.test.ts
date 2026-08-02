import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_LEDGER_CLASSES,
  RECORD_CLASSES,
  countsTowardRecord,
  isOfficialLedgerClass,
  isTerminalSettlement,
  settlementStatusFromLegacy
} from "@/lib/domain/states";
import { checkPublicationInvariants } from "@/lib/domain/publication";
import { summarisePublications, officialPerformanceStatement, type OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { verifyClaimAgainstLedger } from "@/lib/editorial/publicationClaims";
import { buildWeeklyRecap } from "../../netlify/functions/weekly-results-recap-worker-background";

/**
 * Data-integrity contracts for the publication ledger.
 *
 * These encode the failure that motivated the ledger: the public track record
 * held 144 paper-mode rows while the official table held none, and five
 * separate code paths each computed "the record" from a different source. Each
 * test below pins one rule that, had it existed, would have caught it.
 */
const KICKOFF = "2026-08-01T15:00:00.000Z";
const BEFORE = "2026-08-01T12:00:00.000Z";

function publication(overrides: Partial<OfficialPublicationSummary> = {}): OfficialPublicationSummary {
  return {
    publicationId: overrides.publicationId ?? "pub-1",
    fixtureId: "fixture-1",
    fixtureExternalId: "api-football:1",
    sport: "football",
    competition: "Premier League",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    modelProbability: 0.55,
    oddsAtPublication: 2,
    impliedProbability: 0.5,
    publishedAt: BEFORE,
    kickoffAt: KICKOFF,
    publicationStatus: "published",
    settlementStatus: "unsettled",
    settledAt: null,
    correctionReason: null,
    revision: 1,
    ...overrides
  };
}

describe("record taxonomy", () => {
  it("admits exactly one record class to the official ledger", () => {
    expect([...OFFICIAL_LEDGER_CLASSES]).toEqual(["official_public_pick"]);
    for (const recordClass of RECORD_CLASSES) {
      if (recordClass === "official_public_pick") continue;
      expect(isOfficialLedgerClass(recordClass), `${recordClass} must not be official`).toBe(false);
    }
  });

  it("keeps community selections, backtests, simulations and shadow runs out of official performance", () => {
    for (const recordClass of ["community_selection", "backtest_record", "simulation", "shadow_decision"] as const) {
      expect(isOfficialLedgerClass(recordClass)).toBe(false);
    }
  });

  it("treats push, void and cancelled as distinct from a loss", () => {
    expect(countsTowardRecord("lost")).toBe(true);
    for (const status of ["push", "void", "cancelled"] as const) {
      expect(countsTowardRecord(status), `${status} must not count as a played pick`).toBe(false);
      expect(isTerminalSettlement(status)).toBe(true);
    }
  });

  it("maps legacy settlement words without inventing a verdict", () => {
    expect(settlementStatusFromLegacy("pending")).toBe("unsettled");
    expect(settlementStatusFromLegacy("needs_manual_review")).toBe("pending_verification");
    expect(settlementStatusFromLegacy(null)).toBe("unsettled");
    // An unrecognised word must not silently become a win or a loss.
    expect(settlementStatusFromLegacy("mystery")).toBe("pending_verification");
  });
});

describe("publication invariants", () => {
  it("rejects a pick published at or after kickoff", () => {
    const violations = checkPublicationInvariants({
      publishedAt: KICKOFF,
      kickoffAt: KICKOFF,
      evidenceCutoffAt: BEFORE,
      oddsAtPublication: 2,
      modelProbability: 0.5,
      recordClass: "official_public_pick"
    });
    expect(violations.map((violation) => violation.rule)).toContain("publish-before-kickoff");
  });

  it("rejects evidence gathered after the claim was published", () => {
    const violations = checkPublicationInvariants({
      publishedAt: BEFORE,
      kickoffAt: KICKOFF,
      evidenceCutoffAt: "2026-08-01T14:00:00.000Z",
      oddsAtPublication: 2,
      modelProbability: 0.5,
      recordClass: "official_public_pick"
    });
    expect(violations.map((violation) => violation.rule)).toContain("evidence-cutoff-before-publication");
  });

  it("rejects any non-official record class", () => {
    const violations = checkPublicationInvariants({
      publishedAt: BEFORE,
      kickoffAt: KICKOFF,
      evidenceCutoffAt: BEFORE,
      oddsAtPublication: 2,
      modelProbability: 0.5,
      recordClass: "shadow_decision"
    });
    expect(violations.map((violation) => violation.rule)).toContain("official-class-only");
  });

  it("accepts a well-formed pre-kickoff publication", () => {
    expect(
      checkPublicationInvariants({
        publishedAt: BEFORE,
        kickoffAt: KICKOFF,
        evidenceCutoffAt: BEFORE,
        oddsAtPublication: 2.1,
        modelProbability: 0.55,
        recordClass: "official_public_pick"
      })
    ).toEqual([]);
  });
});

describe("official performance aggregation", () => {
  it("never reports a database failure as a zero record", () => {
    const failed = summarisePublications([], "unavailable", "connection refused");
    expect(failed.availability).toBe("unavailable");
    // The critical distinction: no accuracy, rather than 0% accuracy.
    expect(failed.accuracy).toBeNull();
    expect(failed.roi).toBeNull();
    expect(officialPerformanceStatement(failed)).toContain("not a zero");
  });

  it("distinguishes a genuinely empty ledger from an unreadable one", () => {
    const empty = summarisePublications([], "confirmed_empty");
    expect(empty.availability).toBe("confirmed_empty");
    expect(empty.totalPublished).toBe(0);
    expect(officialPerformanceStatement(empty)).toContain("No official public picks have been published yet");
  });

  it("excludes retracted claims from the record in both directions", () => {
    const items = [
      publication({ publicationId: "won-1", settlementStatus: "won" }),
      publication({ publicationId: "lost-1", settlementStatus: "lost" }),
      publication({ publicationId: "retracted-1", settlementStatus: "won", publicationStatus: "retracted" })
    ];
    const summary = summarisePublications(items, "complete");
    expect(summary.totalPublished).toBe(2);
    expect(summary.won).toBe(1);
    expect(summary.accuracy).toBeCloseTo(0.5, 10);
  });

  it("keeps push and void out of the accuracy denominator", () => {
    const items = [
      publication({ publicationId: "w", settlementStatus: "won" }),
      publication({ publicationId: "p", settlementStatus: "push" }),
      publication({ publicationId: "v", settlementStatus: "void" })
    ];
    const summary = summarisePublications(items, "complete");
    expect(summary.accuracy).toBe(1);
    expect(summary.push).toBe(1);
    expect(summary.voided).toBe(1);
    expect(summary.settled).toBe(3);
  });

  it("has no accuracy at all when nothing is decided", () => {
    const summary = summarisePublications([publication({ settlementStatus: "unsettled" })], "complete");
    expect(summary.accuracy).toBeNull();
    expect(summary.roi).toBeNull();
    expect(officialPerformanceStatement(summary)).toContain("none has settled yet");
  });

  it("prices ROI at the odds the claim was struck at", () => {
    const summary = summarisePublications(
      [
        publication({ publicationId: "w", settlementStatus: "won", oddsAtPublication: 3 }),
        publication({ publicationId: "l", settlementStatus: "lost", oddsAtPublication: 2 })
      ],
      "complete"
    );
    // One unit each: 3 back on the winner, 0 on the loser, 2 staked.
    expect(summary.roi).toBeCloseTo(0.5, 10);
  });
});

describe("cross-surface agreement", () => {
  /**
   * Every public count must come from the same aggregation, so a page cannot
   * disagree with another page about the same ledger. This proves the
   * homepage/track-record/performance/weekly-recap numbers are the same
   * function of the same rows rather than four parallel implementations.
   */
  const items = [
    publication({ publicationId: "a", settlementStatus: "won", oddsAtPublication: 2, settledAt: KICKOFF }),
    publication({ publicationId: "b", settlementStatus: "lost", oddsAtPublication: 2, settledAt: KICKOFF }),
    publication({ publicationId: "c", settlementStatus: "won", oddsAtPublication: 4, settledAt: KICKOFF })
  ];

  it("gives the same record to every surface that asks", () => {
    const summary = summarisePublications(items, "complete");
    const recap = buildWeeklyRecap(
      items.map((item) => ({
        result: item.settlementStatus,
        odds: item.oddsAtPublication,
        home_team: "H",
        away_team: "A",
        recommended_selection: item.selectionLabel,
        selection: item.selection
      })),
      new Date("2026-07-25T00:00:00.000Z"),
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-01T00:00:00.000Z")
    );
    expect(recap.wins).toBe(summary.won);
    expect(recap.losses).toBe(summary.lost);
    expect(recap.graded_count).toBe(summary.settled);
    expect(recap.accuracy).toBeCloseTo(summary.accuracy ?? -1, 10);
    expect(recap.roi).toBeCloseTo(summary.roi ?? -1, 10);
  });

  it("reports no accuracy rather than zero for a week with nothing decided", () => {
    const recap = buildWeeklyRecap([], new Date("2026-07-25"), new Date("2026-08-01"), new Date("2026-08-01"));
    expect(recap.graded_count).toBe(0);
    expect(recap.accuracy).toBeNull();
    expect(recap.roi).toBeNull();
  });
});

describe("editorial claims", () => {
  const claim = { statedWins: 2, statedLosses: 1, statedGraded: 3, publicationIds: ["a", "b", "c"] };

  it("verifies a claim the ledger still supports", () => {
    const verification = verifyClaimAgainstLedger(
      claim,
      [
        publication({ publicationId: "a", settlementStatus: "won" }),
        publication({ publicationId: "b", settlementStatus: "won" }),
        publication({ publicationId: "c", settlementStatus: "lost" })
      ],
      "complete"
    );
    expect(verification.status).toBe("verified");
    expect(verification.notice).toBeNull();
  });

  it("raises a correction notice when a referenced pick was retracted", () => {
    const verification = verifyClaimAgainstLedger(
      claim,
      [
        publication({ publicationId: "a", settlementStatus: "won" }),
        publication({ publicationId: "b", settlementStatus: "won", publicationStatus: "retracted" }),
        publication({ publicationId: "c", settlementStatus: "lost" })
      ],
      "complete"
    );
    expect(verification.status).toBe("corrected");
    expect(verification.currentWins).toBe(1);
    expect(verification.notice).toContain("retracted");
  });

  it("says figures are unverified — not corrected — when the ledger cannot be read", () => {
    const verification = verifyClaimAgainstLedger(claim, [], "unavailable");
    expect(verification.status).toBe("unverifiable");
    expect(verification.notice).toContain("could not be read");
  });

  it("flags referenced publications that no longer exist", () => {
    const verification = verifyClaimAgainstLedger(claim, [publication({ publicationId: "a", settlementStatus: "won" })], "partial");
    expect(verification.status).toBe("corrected");
    expect(verification.missingIds).toEqual(["b", "c"]);
  });
});

describe("schema-level guarantees", () => {
  it("enforces the ledger invariants in the database, not only in application code", async () => {
    const migration = await readFile(
      join(process.cwd(), "supabase", "migrations", "20260731163545_publication_ledger.sql"),
      "utf8"
    );
    expect(migration).toContain("check (published_at < kickoff_at)");
    expect(migration).toContain("check (record_class = 'official_public_pick')");
    expect(migration).toMatch(/unique index[\s\S]*op_publication_settlements_current_idx[\s\S]*where is_current/);
    expect(migration).toContain("guard_publication_immutability");
    expect(migration).toContain("op_publication_revisions is append-only");
  });

  it("keeps the public mirror on an allowlist so a new source is withheld by default", async () => {
    const migration = await readFile(
      join(process.cwd(), "supabase", "migrations", "20260731164059_classify_public_mirror.sql"),
      "utf8"
    );
    expect(migration).toContain("record_class");
    expect(migration).toContain("shadow_decision");
    // The mirror may never label anything it receives as an official pick.
    expect(migration).not.toMatch(/v_class\s*:=\s*'official_public_pick'/);
  });

  it("stops the weekly recap reading the shadow mirror", async () => {
    const worker = await readFile(
      join(process.cwd(), "netlify", "functions", "weekly-results-recap-worker-background.ts"),
      "utf8"
    );
    expect(worker).toContain('from("op_publications")');
    expect(worker).not.toContain('from("op_public_prediction_outcomes")');
    expect(worker).toContain('neq("publication_status", "retracted")');
  });
});
