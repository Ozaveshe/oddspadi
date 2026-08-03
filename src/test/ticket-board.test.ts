import { describe, expect, it } from "vitest";
import { buildTicketBoard, DEFAULT_TIERS, MAX_TICKETS } from "@/lib/accumulator/ticketBoard";
import type { DoubleCandidate } from "@/lib/accumulator/dailyDouble";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";

/** Production's measured tennis bands, 2026-08-03. */
const REAL_BANDS: BandEvidence[] = [
  { lowerBound: 0.0, upperBound: 0.1, settledSize: 1, calibrationGap: 0.959 },
  { lowerBound: 0.1, upperBound: 0.2, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.2, upperBound: 0.3, settledSize: 77, calibrationGap: 0.063 },
  { lowerBound: 0.3, upperBound: 0.4, settledSize: 162, calibrationGap: 0.065 },
  { lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 },
  { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
  { lowerBound: 0.6, upperBound: 0.7, settledSize: 162, calibrationGap: 0.034 },
  { lowerBound: 0.7, upperBound: 0.8, settledSize: 77, calibrationGap: 0.024 },
  { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.9, upperBound: 1.0, settledSize: 1, calibrationGap: 0.959 }
];

/** A day's worth of edge-bearing candidates across distinct fixtures. */
function slate(count: number): DoubleCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    fixtureId: `f${index}`,
    competition: `tour-${index % 4}`,
    sport: "tennis",
    kickoffAt: "2026-08-03T18:00:00.000Z",
    market: "match_winner",
    selection: "home",
    selectionLabel: `Player ${index}`,
    modelProbability: 0.72,
    decimalOdds: 1.55,
    // The price implies 1/1.55 = 0.645; the margin-free probability is 0.62,
    // so each leg carries a ~2.5% bookmaker margin and a 10% model edge. An
    // earlier fixture set the fair probability equal to the implied one, which
    // is a market with no vig in it — and the compounding-margin assertion
    // correctly read zero.
    noVigProbability: 0.62,
    bookmakerCount: 5
  }));
}

describe("the ticket board", () => {
  it("builds several tickets across risk tiers", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    expect(board.tickets.length).toBeGreaterThan(1);
    expect(board.tickets.length).toBeLessThanOrEqual(MAX_TICKETS);
    expect(new Set(board.tickets.map((t) => t.tierId)).size).toBeGreaterThan(1);
  });

  it("covers many fixtures rather than repeating one opinion", () => {
    // Ten tickets over eight games is not a board, it is one view restated.
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    expect(board.fixturesCovered).toBeGreaterThanOrEqual(15);
  });

  it("never puts the same fixture twice on one ticket", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    for (const ticket of board.tickets) {
      const ids = ticket.legs.map((leg) => leg.fixtureId);
      expect(new Set(ids).size, `${ticket.tierId} repeated a fixture`).toBe(ids.length);
    }
  });

  it("respects the ticket ceiling", () => {
    const board = buildTicketBoard(slate(200), REAL_BANDS, { maxTickets: 50, ticketsPerTier: 20 });
    expect(board.tickets.length).toBeLessThanOrEqual(MAX_TICKETS);
  });
});

describe("the arithmetic the folklore gets wrong", () => {
  it("expected value RISES with length when every leg has edge", () => {
    // The counter-intuitive part, asserted so nobody 'corrects' it later.
    // EV = product(p * o) - 1. Each leg here returns 0.72 * 1.55 = 1.116, so
    // the product grows with every leg added. Accumulators earn their bad name
    // by combining negative-edge legs, not by being long.
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const shortest = board.tickets.reduce((a, b) => (a.legs.length <= b.legs.length ? a : b));
    const longest = board.tickets.reduce((a, b) => (a.legs.length >= b.legs.length ? a : b));
    expect(longest.legs.length).toBeGreaterThan(shortest.legs.length);
    expect(longest.expectedValue).toBeGreaterThan(shortest.expectedValue);
  });

  it("hit probability COLLAPSES with length at the same time", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const shortest = board.tickets.reduce((a, b) => (a.legs.length <= b.legs.length ? a : b));
    const longest = board.tickets.reduce((a, b) => (a.legs.length >= b.legs.length ? a : b));
    expect(longest.combinedProbability).toBeLessThan(shortest.combinedProbability);
    expect(longest.oneInN).toBeGreaterThan(shortest.oneInN);
  });

  it("says both facts, not the flattering one", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const copy = board.notes.join(" ");
    expect(copy).toContain("expected value rises with length");
    expect(copy).toContain("Winning gets much rarer");
    expect(copy).toContain("most slips on this board will lose");
  });

  it("reports a compounding margin", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const longest = board.tickets.reduce((a, b) => (a.legs.length >= b.legs.length ? a : b));
    const shortest = board.tickets.reduce((a, b) => (a.legs.length <= b.legs.length ? a : b));
    expect(longest.combinedMargin).toBeGreaterThan(shortest.combinedMargin);
  });

  it("a nine-leg ticket is honest about being a lottery ticket", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const longshot = board.tickets.find((ticket) => ticket.tierId === "longshot");
    expect(longshot).toBeDefined();
    if (!longshot) return;
    // 0.72^9 is about 5%: one in twenty, and the page must not round that away.
    expect(longshot.combinedProbability).toBeLessThan(0.1);
    expect(longshot.oneInN).toBeGreaterThan(10);
  });
});

describe("quality gates carry through to tickets", () => {
  it("refuses to build from unmeasured bands", () => {
    // 0.92 sits in a band with one settled outcome behind it.
    const shortPrices = slate(20).map((candidate) => ({
      ...candidate,
      modelProbability: 0.92,
      decimalOdds: 1.12,
      noVigProbability: 0.86
    }));
    const board = buildTicketBoard(shortPrices, REAL_BANDS);
    expect(board.tickets).toEqual([]);
    expect(board.notes[0]).toContain("No selection cleared");
  });

  it("drops legs with no margin-free price", () => {
    const noFair = slate(20).map((candidate) => ({ ...candidate, noVigProbability: null }));
    expect(buildTicketBoard(noFair, REAL_BANDS).tickets).toEqual([]);
  });

  it("promises nothing anywhere in its copy", () => {
    const board = buildTicketBoard(slate(40), REAL_BANDS);
    const copy = [...board.notes, ...DEFAULT_TIERS.map((tier) => `${tier.label} ${tier.intent}`)].join(" ");
    for (const pattern of [
      /\bguaranteed\b/i,
      /\bsure (bet|thing|odds)\b/i,
      /\bbanker\b/i,
      /\bcan(?:'|’)?t lose\b/i,
      /\brisk[- ]free\b/i,
      /\bjackpot guarantee/i
    ]) {
      expect(copy, `copy must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("degrades to an explanation rather than an empty board", () => {
    const board = buildTicketBoard([], REAL_BANDS);
    expect(board.tickets).toEqual([]);
    expect(board.notes.length).toBeGreaterThan(0);
    expect(board.fixturesCovered).toBe(0);
  });
});

describe("the page never hides an empty board", () => {
  it("explains an empty board instead of rendering nothing", async () => {
    const { readFile } = await import("node:fs/promises");
    const page = await readFile("src/app/daily-double/page.tsx", "utf8");
    // The first version guarded the whole section on tickets.length, so an
    // empty board vanished. An absent section is indistinguishable from a
    // broken one, which is the defect this codebase keeps removing.
    expect(page).toContain("No tickets right now");
    expect(page).toContain("Nothing to combine yet");
    expect(page).toContain("Tickets appear once the next slate is priced");
  });
});
