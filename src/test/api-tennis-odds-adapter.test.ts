import { describe, expect, it, vi } from "vitest";
import {
  buildApiTennisOddsUrl,
  fetchApiTennisMatchWinnerOdds,
  normalizeApiTennisMatchWinnerOdds
} from "@/lib/sports/providers/apiTennisOdds";

function documentedPayload() {
  return {
    success: 1,
    result: {
      "00159923": {
        "Home/Away": {
          Home: { bwin: "2.40", bet365: "2.50", Incomplete: "1.85", Fractional: "5/2" },
          Away: { bwin: "1.48", bet365: "1.50", Fractional: "4/7", Bad: "not-a-price" }
        },
        "Correct Score 1st Half": { "6:0": { bet365: "51.00" } }
      }
    }
  };
}

function enrichedPrice(odd: string, bookmakerId: string, bookmakerName: string, updatedAt: string) {
  return {
    odd,
    bookmaker_id: bookmakerId,
    bookmaker_name: bookmakerName,
    updated_at: updatedAt
  };
}

describe("API-Tennis odds adapter", () => {
  it("builds the official get_odds query while preserving exact provider selectors", () => {
    const byMatch = buildApiTennisOddsUrl({
      apiKey: " server-secret ",
      matchKey: "00159923",
      eventTypeKey: 265,
      tournamentKey: "02833"
    });

    expect(byMatch.origin).toBe("https://api.api-tennis.com");
    expect(byMatch.pathname).toBe("/tennis/");
    expect(byMatch.searchParams.get("method")).toBe("get_odds");
    expect(byMatch.searchParams.get("match_key")).toBe("00159923");
    expect(byMatch.searchParams.get("event_type_key")).toBe("265");
    expect(byMatch.searchParams.get("tournament_key")).toBe("02833");
    expect(byMatch.searchParams.get("APIkey")).toBe("server-secret");

    const byDate = buildApiTennisOddsUrl({
      apiKey: "server-secret",
      dateStart: "2026-07-19",
      dateStop: "2026-07-20"
    });
    expect(byDate.searchParams.get("date_start")).toBe("2026-07-19");
    expect(byDate.searchParams.get("date_stop")).toBe("2026-07-20");
    expect(byDate.searchParams.has("match_key")).toBe(false);
  });

  it("rejects unsafe or unbounded query construction", () => {
    expect(() => buildApiTennisOddsUrl({ apiKey: "", matchKey: 1 })).toThrow("non-empty server-only API key");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key" })).toThrow("exact matchKey or a bounded date range");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key", dateStart: "2026-07-19" })).toThrow("dateStart and dateStop together");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key", dateStart: "2026-02-30", dateStop: "2026-03-01" })).toThrow("real YYYY-MM-DD");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key", dateStart: "2026-07-20", dateStop: "2026-07-19" })).toThrow("must not be after");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key", matchKey: "fixture-name" })).toThrow("positive provider identifier");
    expect(() => buildApiTennisOddsUrl({ apiKey: "key", matchKey: 1, baseUrl: "http://api.example.test/tennis/" })).toThrow("must use HTTPS");
  });

  it("retains documented bookmaker names and exact match_key but blocks prices that lack IDs and timestamps", () => {
    const result = normalizeApiTennisMatchWinnerOdds(documentedPayload());

    expect(result.fixtures).toHaveLength(1);
    expect(result.fixtures[0]).toEqual({
      providerMatchKey: "00159923",
      providerUpdatedAt: null,
      quoteEvidence: [
        {
          bookmakerName: "bet365",
          providerBookmakerId: null,
          bookmakerId: null,
          homeDecimalOdds: 2.5,
          awayDecimalOdds: 1.5,
          observedAt: null,
          publicationEligible: false,
          blockers: ["provider-bookmaker-id-missing", "provider-quote-timestamp-missing"]
        },
        {
          bookmakerName: "bwin",
          providerBookmakerId: null,
          bookmakerId: null,
          homeDecimalOdds: 2.4,
          awayDecimalOdds: 1.48,
          observedAt: null,
          publicationEligible: false,
          blockers: ["provider-bookmaker-id-missing", "provider-quote-timestamp-missing"]
        }
      ],
      oddsMarkets: [],
      publicationEligible: false,
      blockers: ["provider-bookmaker-id-missing", "provider-quote-timestamp-missing"]
    });
    expect(result.normalization).toEqual({
      matchesReceived: 1,
      matchesRejected: 0,
      matchesWithCompletePrices: 1,
      matchesPublicationEligible: 0,
      bookmakerCandidates: 5,
      bookmakerQuotesAccepted: 2,
      bookmakerQuotesRejected: 3,
      bookmakerQuotesPublicationEligible: 0
    });
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: "provider-bookmaker-id-missing", affectedFixtures: 1 }),
      expect.objectContaining({ code: "provider-quote-timestamp-missing", affectedFixtures: 1 })
    ]);
    expect(result.blockers[1]?.detail).toContain("freshness/publication gate must remain closed");
  });

  it("emits a two-way match-winner market only from complete explicit identity and freshness evidence", () => {
    const observedAt = "2026-07-19T08:15:00Z";
    const result = normalizeApiTennisMatchWinnerOdds({
      success: "1",
      result: {
        "159924": {
          last_update: "2026-07-19T08:16:00Z",
          "Home/Away": {
            Home: {
              "Book One": enrichedPrice("2.40", "007", "Book One", observedAt),
              "Book Two": enrichedPrice("2.50", "9", "Book Two", observedAt)
            },
            Away: {
              "Book One": enrichedPrice("1.55", "007", "Book One", observedAt),
              "Book Two": enrichedPrice("1.50", "9", "Book Two", observedAt)
            }
          }
        }
      }
    });

    const fixture = result.fixtures[0];
    expect(fixture?.providerMatchKey).toBe("159924");
    expect(fixture?.providerUpdatedAt).toBe("2026-07-19T08:16:00Z");
    expect(fixture?.publicationEligible).toBe(true);
    expect(fixture?.blockers).toEqual([]);
    expect(fixture?.quoteEvidence.map((quote) => ({
      providerBookmakerId: quote.providerBookmakerId,
      bookmakerId: quote.bookmakerId,
      observedAt: quote.observedAt
    }))).toEqual([
      { providerBookmakerId: "007", bookmakerId: "api-tennis-bookmaker:007", observedAt },
      { providerBookmakerId: "9", bookmakerId: "api-tennis-bookmaker:9", observedAt }
    ]);
    expect(fixture?.oddsMarkets).toHaveLength(1);
    expect(fixture?.oddsMarkets[0]).toEqual(expect.objectContaining({
      id: "match_winner",
      priceMethod: "best-price-per-selection-v1",
      consensus: expect.objectContaining({ method: "median-shin-no-vig-v2", bookmakerCount: 2 })
    }));
    expect(fixture?.oddsMarkets[0]?.bookmaker).toBeUndefined();
    expect(fixture?.oddsMarkets[0]?.selections).toEqual([
      { id: "home", label: "Home", decimalOdds: 2.5, bookmaker: { id: "api-tennis-bookmaker:9", name: "Book Two" }, observedAt },
      { id: "away", label: "Away", decimalOdds: 1.55, bookmaker: { id: "api-tennis-bookmaker:007", name: "Book One" }, observedAt }
    ]);
    expect(result.normalization.matchesPublicationEligible).toBe(1);
    expect(result.normalization.bookmakerQuotesPublicationEligible).toBe(2);
  });

  it("rejects incomplete, non-decimal, mismatched-identity, and mismatched-name quote pairs", () => {
    const observedAt = "2026-07-19T08:15:00Z";
    const result = normalizeApiTennisMatchWinnerOdds({
      success: 1,
      result: {
        "159925": {
          "Home/Away": {
            Home: {
              MissingAway: "2.10",
              Fractional: "6/5",
              TooLow: "1.00",
              IdentityMismatch: enrichedPrice("2.20", "10", "IdentityMismatch", observedAt),
              NameMismatch: enrichedPrice("2.30", "11", "Different Name", observedAt),
              TimestampMismatch: enrichedPrice("2.40", "12", "TimestampMismatch", observedAt)
            },
            Away: {
              Fractional: "4/6",
              TooLow: "2.50",
              IdentityMismatch: enrichedPrice("1.70", "13", "IdentityMismatch", observedAt),
              NameMismatch: enrichedPrice("1.60", "11", "NameMismatch", observedAt),
              TimestampMismatch: enrichedPrice("1.55", "12", "TimestampMismatch", "2026-07-19T08:16:00Z")
            }
          }
        }
      }
    });

    expect(result.fixtures[0]?.quoteEvidence).toEqual([
      expect.objectContaining({
        bookmakerName: "TimestampMismatch",
        providerBookmakerId: "12",
        bookmakerId: "api-tennis-bookmaker:12",
        observedAt: null,
        publicationEligible: false,
        blockers: ["provider-quote-timestamp-missing"]
      })
    ]);
    expect(result.fixtures[0]?.oddsMarkets).toEqual([]);
    expect(result.normalization).toEqual(expect.objectContaining({
      bookmakerCandidates: 6,
      bookmakerQuotesAccepted: 1,
      bookmakerQuotesRejected: 5,
      bookmakerQuotesPublicationEligible: 0
    }));
  });

  it("keeps match-level timestamps diagnostic-only instead of manufacturing quote freshness", () => {
    const result = normalizeApiTennisMatchWinnerOdds({
      success: 1,
      result: {
        "159926": {
          updated_at: "2026-07-19T08:15:00Z",
          "Home/Away": { Home: { bwin: "2.00" }, Away: { bwin: "1.80" } }
        }
      }
    });

    expect(result.fixtures[0]?.providerUpdatedAt).toBe("2026-07-19T08:15:00Z");
    expect(result.fixtures[0]?.quoteEvidence[0]).toEqual(expect.objectContaining({ observedAt: null, publicationEligible: false }));
    expect(result.fixtures[0]?.oddsMarkets).toEqual([]);
  });

  it("counts malformed match keys and market containers as rejected provider rows", () => {
    const result = normalizeApiTennisMatchWinnerOdds({
      success: 1,
      result: {
        "not-a-match-key": { "Home/Away": { Home: { Book: "2.00" }, Away: { Book: "1.80" } } },
        "159927": { "Home/Away": [] },
        "159928": { "Home/Away": { Home: { Book: "2.00" }, Away: { Book: "1.80" } } }
      }
    });

    expect(result.fixtures.map((fixture) => fixture.providerMatchKey)).toEqual(["159928"]);
    expect(result.normalization).toEqual(expect.objectContaining({ matchesReceived: 3, matchesRejected: 2 }));
  });

  it("uses an injected transport without returning the secret URL or raw provider body", async () => {
    const calls: Array<{ url: URL; headers: Headers }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
      return Response.json(documentedPayload());
    });
    const result = await fetchApiTennisMatchWinnerOdds({
      apiKey: "private-tennis-key",
      dateStart: "2026-07-19",
      dateStop: "2026-07-19",
      fetchImpl
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("method")).toBe("get_odds");
    expect(calls[0]?.url.searchParams.get("APIkey")).toBe("private-tennis-key");
    expect(calls[0]?.headers.get("accept")).toBe("application/json");
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.request).toEqual({
      method: "get_odds",
      dateStart: "2026-07-19",
      dateStop: "2026-07-19",
      matchKey: null,
      eventTypeKey: null,
      tournamentKey: null
    });
    expect(JSON.stringify(result)).not.toContain("private-tennis-key");

    const failed = await fetchApiTennisMatchWinnerOdds({
      apiKey: "private-tennis-key",
      matchKey: 159923,
      fetchImpl: async () => new Response("private-tennis-key provider detail", { status: 401 })
    });
    expect(failed).toEqual(expect.objectContaining({
      ok: false,
      httpStatus: 401,
      error: "API-Tennis returned HTTP 401.",
      fixtures: []
    }));
    expect(JSON.stringify(failed)).not.toContain("private-tennis-key");
  });

  it("surfaces transport and malformed payload failures without inventing odds", async () => {
    const transportFailure = await fetchApiTennisMatchWinnerOdds({
      apiKey: "key",
      matchKey: 159923,
      fetchImpl: async () => { throw new Error("request failed with secret URL"); }
    });
    expect(transportFailure).toEqual(expect.objectContaining({
      ok: false,
      httpStatus: null,
      error: "API-Tennis odds request failed.",
      fixtures: []
    }));

    const malformed = await fetchApiTennisMatchWinnerOdds({
      apiKey: "key",
      matchKey: 159923,
      fetchImpl: async () => Response.json({ success: 1, result: [] })
    });
    expect(malformed).toEqual(expect.objectContaining({
      ok: false,
      httpStatus: 200,
      error: "API-Tennis returned a malformed odds response.",
      fixtures: []
    }));
  });
});
