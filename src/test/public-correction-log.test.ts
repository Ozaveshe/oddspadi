import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PublicationRevision } from "@/lib/domain/publication";
import { summarisePublications, type OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import {
  buildCorrectionLog,
  correctionLogStatement,
  stateFromLedgerRow,
  type LedgerPublicationState
} from "@/lib/publication/correctionLog";

/**
 * Contracts for the public correction log.
 *
 * The failure these guard against is the quiet one: a claim is amended, the
 * public number moves, and nothing on the site says either happened. Each test
 * below pins one property that makes the amendment legible instead — the
 * original stays readable, a withdrawal stays listed, the arithmetic is
 * reproducible, a cosmetic fix admits to being cosmetic, and an empty log is a
 * statement rather than a stack trace.
 */

const KICKOFF = "2026-08-01T15:00:00.000Z";
const PUBLISHED = "2026-08-01T12:00:00.000Z";

/** A `to_jsonb(op_publications)` capture, snake-cased exactly as Postgres writes it. */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pub-1",
    fixture_external_id: "api-football:1",
    sport: "football",
    competition: "Premier League",
    market: "match_winner",
    selection: "home",
    selection_label: "Home win",
    market_line: null,
    model_probability: 0.55,
    odds_at_publication: 2,
    implied_probability: 0.5,
    published_at: PUBLISHED,
    kickoff_at: KICKOFF,
    publication_status: "published",
    settlement_status: "won",
    public_copy_ref: "copy/pub-1",
    revision: 1,
    ...overrides
  };
}

function liveRow(overrides: Record<string, unknown> = {}): LedgerPublicationState {
  return stateFromLedgerRow(snapshot(overrides));
}

function revision(overrides: Partial<PublicationRevision> & { previousState: Record<string, unknown> }): PublicationRevision {
  return {
    revisionId: overrides.revisionId ?? "rev-1",
    publicationId: overrides.publicationId ?? "pub-1",
    revision: overrides.revision ?? 1,
    reason: overrides.reason ?? "Priced against a stale snapshot.",
    createdAt: overrides.createdAt ?? "2026-08-02T09:00:00.000Z",
    previousState: overrides.previousState
  };
}

/** The same rows as the canonical aggregator sees them, for cross-checking. */
function asSummary(state: LedgerPublicationState): OfficialPublicationSummary {
  return {
    publicationId: state.publicationId,
    fixtureId: state.publicationId,
    fixtureExternalId: state.fixtureExternalId ?? "",
    sport: state.sport ?? "",
    competition: state.competition ?? "",
    market: state.market ?? "",
    selection: state.selection ?? "",
    selectionLabel: state.selectionLabel ?? "",
    modelProbability: state.modelProbability ?? 0,
    oddsAtPublication: state.oddsAtPublication ?? 0,
    impliedProbability: state.impliedProbability ?? 0,
    publishedAt: state.publishedAt ?? PUBLISHED,
    kickoffAt: state.kickoffAt ?? KICKOFF,
    publicationStatus: state.publicationStatus ?? "published",
    settlementStatus: state.settlementStatus ?? "unsettled",
    settledAt: null,
    correctionReason: null,
    revision: state.revision ?? 1
  };
}

describe("a correction preserves the original", () => {
  const original = snapshot({ model_probability: 0.5, odds_at_publication: 2.1, implied_probability: 0.476 });
  const log = buildCorrectionLog({
    publications: [
      liveRow({
        model_probability: 0.61,
        odds_at_publication: 2.1,
        implied_probability: 0.476,
        publication_status: "corrected",
        revision: 2
      })
    ],
    revisions: [revision({ previousState: original, reason: "Calibration profile applied twice." })],
    availability: "complete"
  });

  it("keeps the superseded values readable after the ledger row has moved on", () => {
    const [entry] = log.entries;
    expect(entry.original.modelProbability).toBe(0.5);
    expect(entry.current.modelProbability).toBe(0.61);
    // The point of the whole exercise: the earlier claim did not evaporate.
    expect(log.entries).toHaveLength(1);
    expect(entry.revision).toBe(1);
  });

  it("names the reason and the moment, because an unexplained edit is not a correction", () => {
    const [entry] = log.entries;
    expect(entry.reason).toBe("Calibration profile applied twice.");
    expect(entry.correctedAt).toBe("2026-08-02T09:00:00.000Z");
  });

  it("reports exactly which fields moved and leaves the untouched ones out", () => {
    const [entry] = log.entries;
    const fields = entry.changes.map((change) => change.field);
    expect(fields).toContain("modelProbability");
    expect(fields).toContain("publicationStatus");
    expect(fields).not.toContain("oddsAtPublication");
    const probability = entry.changes.find((change) => change.field === "modelProbability");
    expect(probability).toMatchObject({ previous: 0.5, current: 0.61, label: "Model probability" });
  });

  it("chains multiple corrections to the same claim without losing the middle one", () => {
    const chained = buildCorrectionLog({
      publications: [liveRow({ model_probability: 0.7, publication_status: "corrected", revision: 3 })],
      revisions: [
        revision({ revisionId: "rev-1", revision: 1, previousState: snapshot({ model_probability: 0.5 }) }),
        revision({
          revisionId: "rev-2",
          revision: 2,
          createdAt: "2026-08-03T09:00:00.000Z",
          previousState: snapshot({ model_probability: 0.6, publication_status: "corrected", revision: 2 })
        })
      ],
      availability: "complete"
    });
    // Newest first.
    expect(chained.entries.map((entry) => entry.revision)).toEqual([2, 1]);
    expect(chained.entries[1].current.modelProbability).toBe(0.6);
    expect(chained.entries[0].original.modelProbability).toBe(0.6);
    expect(chained.entries[0].current.modelProbability).toBe(0.7);
  });
});

describe("a retraction stays visible", () => {
  const publications = [
    liveRow({ id: "won-1", settlement_status: "won" }),
    liveRow({ id: "lost-1", settlement_status: "lost" }),
    liveRow({ id: "pulled-1", settlement_status: "won", publication_status: "retracted", revision: 2 })
  ];
  const log = buildCorrectionLog({
    publications,
    revisions: [
      revision({
        revisionId: "rev-pulled",
        publicationId: "pulled-1",
        previousState: snapshot({ id: "pulled-1", settlement_status: "won" }),
        reason: "Published against a price that had already been withdrawn."
      })
    ],
    availability: "complete"
  });

  it("lists the withdrawn claim instead of dropping it", () => {
    expect(log.entries).toHaveLength(1);
    expect(log.retractions).toBe(1);
    expect(log.corrections).toBe(0);
    expect(log.entries[0].kind).toBe("retraction");
    expect(log.entries[0].publicationId).toBe("pulled-1");
  });

  it("still shows what the withdrawn claim said", () => {
    expect(log.entries[0].original.selectionLabel).toBe("Home win");
    expect(log.entries[0].original.settlementStatus).toBe("won");
    expect(log.entries[0].original.publicationStatus).toBe("published");
  });

  it("removes the withdrawn win from the record in both directions", () => {
    const { effect } = log.entries[0];
    expect(effect.before).toMatchObject({ won: 2, lost: 1 });
    expect(effect.after).toMatchObject({ won: 1, lost: 1 });
    expect(effect.wonDelta).toBe(-1);
    expect(effect.lostDelta).toBe(0);
    // A retracted claim is not converted into a loss, which is the mistake
    // that would make withdrawal look like honesty while being a punishment.
    expect(effect.voidedDelta).toBe(0);
  });
});

describe("aggregates recalculate after a correction", () => {
  const publications = [
    liveRow({ id: "won-1", settlement_status: "won" }),
    liveRow({ id: "won-2", settlement_status: "won" }),
    liveRow({ id: "lost-1", settlement_status: "lost" }),
    liveRow({ id: "void-1", settlement_status: "void" }),
    liveRow({ id: "pulled-1", settlement_status: "won", publication_status: "retracted", revision: 2 })
  ];
  const log = buildCorrectionLog({
    publications,
    revisions: [
      revision({
        revisionId: "rev-pulled",
        publicationId: "pulled-1",
        previousState: snapshot({ id: "pulled-1", settlement_status: "won" }),
        reason: "Duplicate of an existing claim on the same selection."
      })
    ],
    availability: "complete"
  });

  it("moves the win rate by the amount the retracted win was worth", () => {
    const { effect } = log.entries[0];
    // 3 wins and 1 loss becomes 2 and 1.
    expect(effect.before.winRate).toBeCloseTo(3 / 4, 10);
    expect(effect.after.winRate).toBeCloseTo(2 / 3, 10);
    expect(effect.winRateDelta).toBeCloseTo(2 / 3 - 3 / 4, 10);
    expect(effect.movedTheRecord).toBe(true);
    // Push/void/cancelled never entered the denominator on either side.
    expect(effect.before.voided).toBe(1);
    expect(effect.after.voided).toBe(1);
  });

  it("lands on exactly the numbers the canonical aggregator produces", () => {
    const canonical = summarisePublications(publications.map(asSummary), "complete");
    expect(log.currentAggregate).not.toBeNull();
    expect(log.currentAggregate?.won).toBe(canonical.won);
    expect(log.currentAggregate?.lost).toBe(canonical.lost);
    expect(log.currentAggregate?.voided).toBe(canonical.push + canonical.voided + canonical.cancelled);
    expect(log.currentAggregate?.winRate).toBeCloseTo(canonical.accuracy ?? -1, 10);
  });

  it("reports no win rate rather than a zero one when nothing is decided", () => {
    const undecided = buildCorrectionLog({
      publications: [liveRow({ id: "pulled-1", settlement_status: "unsettled", publication_status: "retracted", revision: 2 })],
      revisions: [
        revision({
          revisionId: "rev-pulled",
          publicationId: "pulled-1",
          previousState: snapshot({ id: "pulled-1", settlement_status: "unsettled" })
        })
      ],
      availability: "complete"
    });
    const { effect } = undecided.entries[0];
    expect(effect.before.winRate).toBeNull();
    expect(effect.after.winRate).toBeNull();
    // Null minus null is not zero; a delta we cannot compute is not a delta of none.
    expect(effect.winRateDelta).toBeNull();
    expect(effect.movedTheRecord).toBe(false);
  });
});

describe("a correction with no effect on the record says so", () => {
  const log = buildCorrectionLog({
    publications: [
      liveRow({ id: "won-1", settlement_status: "won", public_copy_ref: "copy/v2", publication_status: "corrected", revision: 2 }),
      liveRow({ id: "lost-1", settlement_status: "lost" })
    ],
    revisions: [
      revision({
        revisionId: "rev-copy",
        publicationId: "won-1",
        previousState: snapshot({ id: "won-1", settlement_status: "won", public_copy_ref: "copy/v1" }),
        reason: "The published explanation named the wrong away side."
      })
    ],
    availability: "complete"
  });

  it("reports a zero delta on every count", () => {
    const { effect } = log.entries[0];
    expect(effect.wonDelta).toBe(0);
    expect(effect.lostDelta).toBe(0);
    expect(effect.voidedDelta).toBe(0);
    expect(effect.winRateDelta).toBe(0);
    expect(effect.movedTheRecord).toBe(false);
    expect(effect.before).toEqual(effect.after);
  });

  it("still lists the correction, because a cosmetic fix is still an edit", () => {
    expect(log.entries).toHaveLength(1);
    expect(log.corrections).toBe(1);
    expect(log.entries[0].changes.map((change) => change.field)).toContain("publicCopyRef");
    expect(correctionLogStatement(log)).toContain("None of them changed the published win, loss or void counts.");
  });
});

describe("an empty log is a statement, not an error", () => {
  const empty = buildCorrectionLog({ publications: [], revisions: [], availability: "complete" });

  it("reports confirmed-empty with no entries and no thrown error", () => {
    expect(empty.entries).toEqual([]);
    expect(empty.availability).toBe("confirmed_empty");
    expect(empty.corrections).toBe(0);
    expect(empty.retractions).toBe(0);
    expect(correctionLogStatement(empty)).toBe(
      "No corrections have been issued. Every published claim stands exactly as it was first published."
    );
  });

  it("stays empty rather than erroring when the ledger has claims but no corrections", () => {
    const uncorrected = buildCorrectionLog({
      publications: [liveRow({ id: "won-1", settlement_status: "won" })],
      revisions: [],
      availability: "complete"
    });
    expect(uncorrected.entries).toEqual([]);
    expect(uncorrected.currentAggregate).toMatchObject({ won: 1, lost: 0, winRate: 1 });
  });

  it("distinguishes an unreadable log from an empty one", () => {
    const broken = buildCorrectionLog({
      publications: [],
      revisions: [],
      availability: "unavailable",
      unavailableReason: "statement timeout"
    });
    expect(broken.availability).toBe("unavailable");
    // Not zero corrections — unknown corrections.
    expect(broken.currentAggregate).toBeNull();
    expect(correctionLogStatement(broken)).toContain("statement timeout");
    expect(correctionLogStatement(broken)).toContain("not a claim that none has");
  });
});

describe("revisions whose claim cannot be read", () => {
  it("counts them instead of guessing at a before and after", () => {
    const log = buildCorrectionLog({
      publications: [],
      revisions: [revision({ publicationId: "missing-1", previousState: snapshot({ id: "missing-1" }) })],
      availability: "complete"
    });
    expect(log.entries).toEqual([]);
    expect(log.unresolved).toBe(1);
  });
});

describe("the log is grounded in the sanctioned correction path", () => {
  it("reads the columns the correction RPC actually writes", async () => {
    const migration = await readFile(
      join(process.cwd(), "supabase", "migrations", "20260731163545_publication_ledger.sql"),
      "utf8"
    );
    // The reader depends on all three: a reason, a verbatim prior state, and an
    // append-only guarantee that neither can be edited afterwards.
    expect(migration).toContain("insert into public.op_publication_revisions (publication_id, revision, previous_state, reason)");
    expect(migration).toContain("to_jsonb(v_current)");
    expect(migration).toContain("op_publication_revisions is append-only");
    // Public read on revisions is what makes a public log possible at all.
    expect(migration).toMatch(/op_publication_revisions_public_read[\s\S]*for select using \(true\)/);
  });
});
