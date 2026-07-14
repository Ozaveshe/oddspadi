import { describe, expect, it } from "vitest";

import {
  resolveHistoricalFootballOdds,
  type HistoricalFootballOddsQuote
} from "@/lib/sports/training/historicalFootballOdds";
import { buildFootballProviderFeatureMaterializer } from "@/lib/sports/training/footballDataProviderFeatureMaterializer";

const kickoffAt = "2026-02-14T15:00:00.000Z";

function snapshot({
  bookmaker = "book-a",
  observedAt = "2026-02-14T10:00:00.000Z",
  closing = false,
  odds = [2.1, 3.4, 3.7]
}: {
  bookmaker?: string;
  observedAt?: string;
  closing?: boolean;
  odds?: [number, number, number];
} = {}): HistoricalFootballOddsQuote[] {
  return (["home", "draw", "away"] as const).map((selection, index) => ({
    market: "match_winner",
    selection,
    decimalOdds: odds[index],
    bookmaker,
    observedAt,
    isClosing: closing
  }));
}

describe("historical football odds resolution", () => {
  it("refuses to assemble one market from mixed bookmakers or timestamps", () => {
    const quotes = [
      snapshot({ bookmaker: "book-a" })[0]!,
      snapshot({ bookmaker: "book-b" })[1]!,
      snapshot({ bookmaker: "book-a", observedAt: "2026-02-14T11:00:00.000Z" })[2]!
    ];

    const result = resolveHistoricalFootballOdds(quotes, { kickoffAt });

    expect(result.decisionSnapshot).toBeNull();
    expect(result.audit).toMatchObject({
      status: "no-coherent-decision",
      coherentDecisionSnapshots: 0,
      rejectedGroups: 3
    });
  });

  it("chooses the latest coherent pre-match decision snapshot deterministically", () => {
    const result = resolveHistoricalFootballOdds([
      ...snapshot({ bookmaker: "book-old", observedAt: "2026-02-14T08:00:00.000Z" }),
      ...snapshot({ bookmaker: "book-latest", observedAt: "2026-02-14T12:00:00.000Z", odds: [2, 3.5, 4] })
    ], { kickoffAt });

    expect(result.decisionSnapshot).toMatchObject({
      bookmaker: "book-latest",
      observedAt: "2026-02-14T12:00:00.000Z",
      odds: { home: 2, draw: 3.5, away: 4 }
    });
    expect(Object.values(result.decisionSnapshot!.noVigProbabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("uses only an explicit later close from the selected bookmaker", () => {
    const result = resolveHistoricalFootballOdds([
      ...snapshot(),
      ...snapshot({ bookmaker: "book-b", observedAt: "2026-02-14T14:30:00.000Z", closing: true }),
      ...snapshot({ observedAt: "2026-02-14T14:40:00.000Z", closing: true, odds: [1.95, 3.6, 4.2] })
    ], { kickoffAt });

    expect(result.audit.status).toBe("ready");
    expect(result.closingSnapshot).toMatchObject({
      bookmaker: "book-a",
      observedAt: "2026-02-14T14:40:00.000Z",
      odds: { home: 1.95, draw: 3.6, away: 4.2 }
    });
  });

  it("never relabels ordinary later quotes or another bookmaker as the close", () => {
    const ordinaryLater = resolveHistoricalFootballOdds([
      ...snapshot(),
      ...snapshot({ observedAt: "2026-02-14T14:40:00.000Z", odds: [1.95, 3.6, 4.2] })
    ], { kickoffAt });
    const otherBookClose = resolveHistoricalFootballOdds([
      ...snapshot(),
      ...snapshot({ bookmaker: "book-b", observedAt: "2026-02-14T14:40:00.000Z", closing: true })
    ], { kickoffAt });

    expect(ordinaryLater.audit.status).toBe("decision-only");
    expect(ordinaryLater.closingSnapshot).toBeNull();
    expect(otherBookClose.audit.status).toBe("decision-only");
    expect(otherBookClose.closingSnapshot).toBeNull();
  });

  it("rejects missing or post-kickoff timestamps and conflicting duplicate selections", () => {
    const missingAndLate = resolveHistoricalFootballOdds([
      ...snapshot().map((quote) => ({ ...quote, observedAt: null })),
      ...snapshot({ observedAt: "2026-02-14T15:01:00.000Z" })
    ], { kickoffAt });
    const conflicting = resolveHistoricalFootballOdds([
      ...snapshot(),
      { ...snapshot()[0]!, decimalOdds: 2.5 }
    ], { kickoffAt });

    expect(missingAndLate.audit).toMatchObject({ rejectedQuotes: 6, status: "no-coherent-decision" });
    expect(conflicting.decisionSnapshot).toBeNull();
    expect(conflicting.audit.rejectedGroups).toBe(1);
  });

  it("keeps provider feature previews locked when only a synthetic mixed-book market can be formed", () => {
    const mixedQuotes = [
      snapshot({ bookmaker: "book-a" })[0]!,
      snapshot({ bookmaker: "book-b" })[1]!,
      snapshot({ bookmaker: "book-c" })[2]!
    ];
    const materializer = buildFootballProviderFeatureMaterializer({
      fixtures: [{
        externalId: "mixed-market",
        kickoffAt,
        league: { externalId: "league-1", name: "Test League" },
        status: "finished",
        homeTeam: { externalId: "home-1", name: "Home" },
        awayTeam: { externalId: "away-1", name: "Away" },
        homeScore: 2,
        awayScore: 1,
        odds: mixedQuotes
      }],
      now: new Date("2026-02-15T10:00:00.000Z")
    });

    expect(materializer.status).toBe("blocked-no-odds");
    expect(materializer.previewRows).toEqual([]);
    expect(materializer.corpus.withCompleteOdds).toBe(0);
  });
});
