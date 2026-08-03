import { detectCorrelations, resolveCombinationBasis, type CombinationBasis } from "@/lib/workspace/correlation";
import type { AnalysedLeg } from "@/lib/workspace/selection";
import { eligibleLegs, type DoubleCandidate, type DoubleLeg } from "@/lib/accumulator/dailyDouble";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";

/**
 * A day's ticket board: several accumulators across risk tiers.
 *
 * Combining a handful of games into one big number is how this audience bets.
 * Building one two-leg slip and calling it a product ignores that, and the
 * people who want a ten-leg ticket will build it anyway — with no maths at all.
 *
 * The arithmetic here is less damning than the folklore, and getting it right
 * matters. Expected value multiplies: EV = product(p_i * o_i) - 1. If every leg
 * carries genuine positive edge then a longer ticket has *higher* expected
 * value, not lower. What collapses is the chance of winning — eight legs at 70%
 * land together 5.8% of the time — and what compounds is the bookmaker's
 * margin, which is why combining negative-edge legs is ruinous and why most
 * accumulators are.
 *
 * So the board is honest in a specific way: it will tell you a ten-leg ticket
 * has better expected value than a double and still loses nineteen times out of
 * twenty. Both are true, neither is the whole picture, and hiding either one
 * would be the dishonest version of this feature.
 */

export type TicketTier = {
  id: string;
  label: string;
  legs: number;
  /** Plain description of what this tier is for. */
  intent: string;
};

/**
 * Tiers chosen to span how people actually stake: a short "banker", a
 * mid-length ticket, and a genuine longshot. Names avoid promising anything —
 * "banker" is the punter's word for a short price, not a claim of safety, so it
 * is not used here.
 */
export const DEFAULT_TIERS: TicketTier[] = [
  { id: "short", label: "Two-leg", legs: 2, intent: "Shortest combination on the board. Highest chance of landing, smallest return." },
  { id: "standard", label: "Four-leg", legs: 4, intent: "The common shape. Meaningful return, still inside one evening's fixtures." },
  { id: "long", label: "Six-leg", legs: 6, intent: "Longer combination. Expected value is better; the chance of landing is much worse." },
  { id: "longshot", label: "Nine-leg", legs: 9, intent: "A lottery ticket with a model behind it. Expect it to lose almost every time." }
];

export type Ticket = {
  tierId: string;
  tierLabel: string;
  legs: DoubleLeg[];
  combinedOdds: number;
  /** Product of leg probabilities. Only meaningful for independent legs. */
  combinedProbability: number;
  /** Product of (probability x price) minus one. Positive when every leg has edge. */
  expectedValue: number;
  /** Margin the whole ticket carries, which compounds with each leg. */
  combinedMargin: number;
  /** 1 in N, rounded, for the chance of the ticket landing. */
  oneInN: number;
  basis: CombinationBasis;
};

export type TicketBoard = {
  tickets: Ticket[];
  /** Distinct fixtures represented across the whole board. */
  fixturesCovered: number;
  /** Legs that qualified but did not make any ticket. */
  unusedLegs: number;
  notes: string[];
};

/** Ten tickets is the ceiling; beyond that the board stops being readable. */
export const MAX_TICKETS = 10;

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function analysedFor(legs: DoubleLeg[]): AnalysedLeg[] {
  return legs.map(
    (leg) =>
      ({
        selection: {
          fixtureId: leg.fixtureId,
          competition: leg.competition,
          sport: leg.sport,
          kickoffAt: leg.kickoffAt,
          market: leg.market,
          selection: leg.selection
        }
      }) as unknown as AnalysedLeg
  );
}

function buildTicket(tier: TicketTier, legs: DoubleLeg[]): Ticket {
  const combinedOdds = legs.reduce((product, leg) => product * leg.decimalOdds, 1);
  const combinedProbability = legs.reduce((product, leg) => product * leg.modelProbability, 1);
  // Expected value multiplies across independent legs. Positive-edge legs
  // therefore compound into a *better* expectation, not a worse one — the
  // opposite of the usual folklore, and only true because every leg here had
  // to clear its band and carry a real edge first.
  const expectedValue = legs.reduce((product, leg) => product * (leg.modelProbability * leg.decimalOdds), 1) - 1;
  const fairCombined = legs.reduce((product, leg) => product * (leg.noVigProbability ?? 0), 1);
  const impliedCombined = 1 / combinedOdds;
  // Overround as a ratio, not an absolute probability difference.
  //
  // Both probabilities shrink toward zero as legs are added, so their
  // difference shrinks with them: a nine-leg ticket showed 0.58% against a
  // double's 3.18% and looked *cheaper*, when it actually carries 42.6% margin
  // against the double's 8.3%. Understating the cost precisely where it
  // compounds is the worst possible direction for this number to be wrong in.
  const combinedMargin = fairCombined > 0 ? impliedCombined / fairCombined - 1 : 0;
  const findings = detectCorrelations(analysedFor(legs));

  return {
    tierId: tier.id,
    tierLabel: tier.label,
    legs,
    combinedOdds: round(combinedOdds, 2),
    combinedProbability: round(combinedProbability, 6),
    expectedValue: round(expectedValue, 4),
    combinedMargin: round(combinedMargin, 4),
    oneInN: combinedProbability > 0 ? Math.round(1 / combinedProbability) : 0,
    basis: resolveCombinationBasis(analysedFor(legs), findings)
  };
}

/**
 * Spread tickets across the day's fixtures rather than stacking the same few.
 *
 * Legs are taken round-robin from the ranked pool with a used-fixture set per
 * ticket, and the starting offset walks forward between tickets. Without that,
 * every tier picks the same top legs and ten tickets cover eight games — which
 * is not a board, it is one opinion repeated.
 */
function drawLegs(pool: DoubleLeg[], count: number, offset: number): DoubleLeg[] {
  const chosen: DoubleLeg[] = [];
  const usedFixtures = new Set<string>();
  for (let step = 0; step < pool.length && chosen.length < count; step += 1) {
    const leg = pool[(offset + step) % pool.length];
    // One leg per fixture inside a ticket: two selections on the same match are
    // the same bet twice, and multiplying them is straightforwardly wrong.
    if (usedFixtures.has(leg.fixtureId)) continue;
    usedFixtures.add(leg.fixtureId);
    chosen.push(leg);
  }
  return chosen.length === count ? chosen : [];
}

export function buildTicketBoard(
  candidates: DoubleCandidate[],
  bands: BandEvidence[],
  options: { tiers?: TicketTier[]; maxTickets?: number; ticketsPerTier?: number } = {}
): TicketBoard {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  const maxTickets = Math.min(options.maxTickets ?? MAX_TICKETS, MAX_TICKETS);
  const ticketsPerTier = Math.max(1, options.ticketsPerTier ?? Math.ceil(maxTickets / tiers.length));
  const pool = eligibleLegs(candidates, bands);

  if (!pool.length) {
    return {
      tickets: [],
      fixturesCovered: 0,
      unusedLegs: 0,
      notes: ["No selection cleared the calibrated probability bands today, so no ticket could be built."]
    };
  }

  const tickets: Ticket[] = [];
  let offset = 0;
  for (const tier of tiers) {
    for (let index = 0; index < ticketsPerTier && tickets.length < maxTickets; index += 1) {
      const legs = drawLegs(pool, tier.legs, offset);
      // Walk the offset even on failure so the next attempt sees a different
      // slice rather than retrying the same one.
      offset = (offset + Math.max(1, tier.legs)) % pool.length;
      if (!legs.length) continue;
      tickets.push(buildTicket(tier, legs));
    }
  }

  const usedFixtures = new Set(tickets.flatMap((ticket) => ticket.legs.map((leg) => leg.fixtureId)));
  const notes: string[] = [];
  if (tickets.length) {
    const longest = tickets.reduce((best, ticket) => (ticket.legs.length > best.legs.length ? ticket : best));
    const shortest = tickets.reduce((best, ticket) => (ticket.legs.length < best.legs.length ? ticket : best));
    notes.push(
      `Every leg on this board cleared its probability band and carries a positive edge, which is why expected value rises with length: the ${longest.legs.length}-leg ticket expects ${(longest.expectedValue * 100).toFixed(0)}% against the ${shortest.legs.length}-leg ticket's ${(shortest.expectedValue * 100).toFixed(0)}%.`
    );
    notes.push(
      `Winning gets much rarer at the same time. The ${longest.legs.length}-leg ticket lands about 1 time in ${longest.oneInN}; the ${shortest.legs.length}-leg lands about 1 in ${shortest.oneInN}. Both statements are true and neither one is the whole picture.`
    );
    notes.push(
      `The bookmaker's margin compounds with every leg — the ${longest.legs.length}-leg ticket carries about ${(longest.combinedMargin * 100).toFixed(1)}%. Adding legs to a slip of negative-edge selections is how accumulators earn their reputation; it is the edge on each leg that changes the arithmetic, not the number of legs.`
    );
    notes.push("Expected value is a long-run average across many tickets. It is not a forecast for any single slip, and most slips on this board will lose.");
  }

  return {
    tickets,
    fixturesCovered: usedFixtures.size,
    unusedLegs: Math.max(0, pool.length - tickets.reduce((sum, ticket) => sum + ticket.legs.length, 0)),
    notes
  };
}
