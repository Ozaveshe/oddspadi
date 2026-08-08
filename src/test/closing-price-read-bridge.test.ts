import { describe, expect, it } from "vitest";
import { readOfficialPublicationPage } from "@/lib/domain/canonicalReads";
import { readClosingPricesFor } from "@/lib/closing/publicationCloses";
import { publicationClosingLineValue, computeTrackRecordSummary } from "@/lib/performance/trackRecordSummary";
import { clvDistribution } from "@/lib/performance/advancedMetrics";
import { fakeLedgerClient, type FakeRow } from "@/test/support/fakeLedgerClient";

/**
 * The join that was never made.
 *
 * `op_closing_prices` has held captured closes since `close.v1`, and the track
 * record resolved `closingOdds` out of `op_publications.metadata` — a key no
 * production writer has ever set. Both halves worked; nothing connected them,
 * so the page whose job is to report closing-line value rendered 0% coverage
 * over 293 publications while the closing table sat beside it.
 *
 * These tests pin the connection and, just as importantly, pin what must NOT
 * happen when a close is absent: it stays absent, with a reason, and never
 * becomes a zero or a substitute price.
 */

const KICKOFF = "2026-08-03T15:00:00.000Z";

function publicationRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: "pub-1",
    fixture_id: "fixture-1",
    fixture_external_id: "api-football:1",
    sport: "football",
    competition: "Premier League",
    market: "match_winner",
    selection: "home",
    selection_label: "Home win",
    model_probability: 0.55,
    odds_at_publication: 2.2,
    implied_probability: 0.45,
    published_at: "2026-08-03T12:00:00.000Z",
    kickoff_at: KICKOFF,
    publication_status: "published",
    settlement_status: "won",
    settled_at: "2026-08-03T17:00:00.000Z",
    correction_reason: null,
    revision: 1,
    market_line: null,
    model_version: "football-v4",
    feature_set_version: "features-v3",
    calibration_version: "cal-2026-08",
    decision_policy_version: "policy-v2",
    decision_status: "pick",
    data_quality: "complete",
    evidence_cutoff_at: "2026-08-03T11:00:00.000Z",
    odds_snapshot_at: "2026-08-03T11:55:00.000Z",
    public_copy_ref: null,
    supersedes_publication_id: null,
    metadata: {},
    ...overrides
  };
}

function closingRow(overrides: FakeRow = {}): FakeRow {
  return {
    publication_id: "pub-1",
    closing_odds: 2,
    closing_probability: 0.5,
    published_probability_novig: 0.46,
    capture_status: "captured",
    missing_reason: null,
    source: "consensus",
    source_count: 3,
    close_observed_at: "2026-08-03T14:50:00.000Z",
    captured_at: "2026-08-03T16:00:00.000Z",
    is_current: true,
    ...overrides
  };
}

const page = (tables: Record<string, FakeRow[]>, failing?: Record<string, string>) =>
  readOfficialPublicationPage({ client: fakeLedgerClient(tables, failing ? { failing } : {}) });

describe("closing prices reach the publications they belong to", () => {
  it("resolves a captured close onto the claim", async () => {
    const result = await page({ op_publications: [publicationRow()], op_closing_prices: [closingRow()] });
    const item = result.items[0]!;
    expect(item.closingOdds).toBe(2);
    expect(item.closingCaptureStatus).toBe("captured");
    expect(item.closingMissingReason).toBeNull();
    expect(result.availability).toBe("complete");
  });

  it("computes CLV for a known pair", async () => {
    // Published 2.2, closed 2.0 => 2.2/2.0 − 1 = +0.1 exactly.
    const result = await page({ op_publications: [publicationRow()], op_closing_prices: [closingRow()] });
    expect(publicationClosingLineValue(result.items[0]!)).toBeCloseTo(0.1, 10);
  });

  it("keeps an absent close absent and carries the reason", async () => {
    const result = await page({
      op_publications: [publicationRow()],
      op_closing_prices: [
        closingRow({
          closing_odds: null,
          closing_probability: null,
          capture_status: "insufficient_sources",
          missing_reason: "Only 1 book priced this selection at the close; 3 required.",
          source_count: 1
        })
      ]
    });
    const item = result.items[0]!;
    expect(item.closingOdds).toBeNull();
    expect(item.closingCaptureStatus).toBe("insufficient_sources");
    expect(item.closingMissingReason).toContain("3 required");
    // The failure this design exists to prevent.
    expect(publicationClosingLineValue(item)).toBeNull();
  });

  it("excludes a missing close from CLV rather than counting it as zero", async () => {
    const summary = computeTrackRecordSummary({
      publications: (
        await page({
          op_publications: [
            publicationRow(),
            publicationRow({ id: "pub-2", fixture_external_id: "api-football:2", published_at: "2026-08-03T11:00:00.000Z" })
          ],
          op_closing_prices: [
            closingRow(),
            closingRow({ publication_id: "pub-2", closing_odds: null, closing_probability: null, capture_status: "no_quotes", missing_reason: "No quote was observed for this selection inside the closing window." })
          ]
        })
      ).items,
      availability: "complete",
      unavailableReason: null,
      truncated: false,
      minSample: 1
    });

    // One of two rows carries a close, and the average CLV is that row's own
    // value — not halved by treating the other as zero.
    expect(summary.closingCoverageCount).toBe(1);
    expect(summary.closingCoverage.value).toBeCloseTo(0.5, 10);
    expect(summary.averageClosingLineValue.value).toBeCloseTo(0.1, 10);
    expect(summary.averageClosingLineValue.state).toBe("measured");
  });

  it("still honours a metadata close for rows written before the table existed", async () => {
    const result = await page({
      op_publications: [publicationRow({ metadata: { closingOdds: 2 } })],
      op_closing_prices: []
    });
    expect(result.items[0]!.closingOdds).toBe(2);
    expect(result.items[0]!.closingCaptureStatus).toBeNull();
  });

  it("prefers the captured close over a metadata one", async () => {
    // The capture was produced by a stated policy with its source count and
    // observation time recorded; the metadata number has no provenance at all.
    const result = await page({
      op_publications: [publicationRow({ metadata: { closingOdds: 5 } })],
      op_closing_prices: [closingRow()]
    });
    expect(result.items[0]!.closingOdds).toBe(2);
  });

  it("reports a closing-table outage as partial rather than as zero coverage", async () => {
    const result = await page({ op_publications: [publicationRow()], op_closing_prices: [closingRow()] }, {
      op_closing_prices: "permission denied"
    });
    expect(result.items).toHaveLength(1);
    expect(result.availability).toBe("partial");
    expect(result.unavailableReason).toContain("Closing prices could not be read");
  });

  it("refuses a stored price of 1.00 or less as a price at all", async () => {
    const lookup = await readClosingPricesFor(
      ["pub-1"],
      fakeLedgerClient({ op_closing_prices: [closingRow({ closing_odds: 1 })] })
    );
    expect(lookup.byPublicationId.get("pub-1")?.closingOdds).toBeNull();
  });

  it("asks for nothing when there are no publications", async () => {
    const lookup = await readClosingPricesFor([], fakeLedgerClient({}));
    expect(lookup.unavailable).toBe(false);
    expect(lookup.byPublicationId.size).toBe(0);
  });

  /**
   * The advanced-metrics path takes the same rows, so the close has to survive
   * the trip without anyone re-deriving it. `clvDistribution` already refused
   * to treat a missing close as zero; what it never had was a close to read.
   */
  it("feeds clvDistribution from the ledger without counting misses as zero", async () => {
    const items = (
      await page({
        op_publications: [
          publicationRow(),
          publicationRow({ id: "pub-2", fixture_external_id: "api-football:2", published_at: "2026-08-03T11:00:00.000Z" })
        ],
        op_closing_prices: [
          closingRow(),
          closingRow({
            publication_id: "pub-2",
            closing_odds: null,
            closing_probability: null,
            capture_status: "insufficient_sources",
            missing_reason: "Only 2 books priced this selection at the close; 3 required."
          })
        ]
      })
    ).items;

    const clv = clvDistribution(items, { now: new Date("2026-08-04T00:00:00.000Z"), minSample: 1 });

    expect(clv.eligible).toBe(2);
    expect(clv.covered).toBe(1);
    expect(clv.coverage.value).toBeCloseTo(0.5, 10);
    // +0.1 from the one covered pick, not +0.05 from averaging in a zero.
    expect(clv.meanClv.value).toBeCloseTo(0.1, 10);
  });
});
