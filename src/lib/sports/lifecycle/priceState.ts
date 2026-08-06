/**
 * Whether a price is still worth showing, and whether it may back a claim.
 *
 * There was one implicit threshold for everything, which is wrong in both
 * directions at once. A Premier League 1X2 price is still roughly right two
 * hours out; a tennis match price can be stale in minutes, because two-way
 * markets on a short card move on every break of serve. One number either
 * hides prices that were fine or, worse, lets a dead price support a live
 * value claim.
 *
 * So the budget is per sport and per market family, and it tightens as kickoff
 * approaches — the last hour is when lines move most and when a visitor is
 * most likely to act on one.
 *
 * These are policy, not measurement. They are the intervals we are willing to
 * stand behind publicly, and they should be revisited against observed line
 * movement rather than treated as discovered constants.
 */

const MINUTE = 60_000;

type MarketBudget = { default: number } & Record<string, number>;

const PRICE_TTL_MS: Record<string, MarketBudget> = {
  football: { default: 15 * MINUTE, "1x2": 15 * MINUTE, totals: 10 * MINUTE, handicap: 10 * MINUTE, btts: 12 * MINUTE },
  basketball: { default: 8 * MINUTE, moneyline: 8 * MINUTE, totals: 6 * MINUTE, spread: 6 * MINUTE },
  tennis: { default: 5 * MINUTE, moneyline: 5 * MINUTE, totals: 4 * MINUTE }
};
const FALLBACK_BUDGET: MarketBudget = { default: 10 * MINUTE };

/** Inside this much of kickoff, budgets halve. */
const NEAR_KICKOFF_MS = 60 * MINUTE;

export function priceTtlMs(sport: string, market: string, msToKickoff: number): number {
  const budget = PRICE_TTL_MS[sport] ?? FALLBACK_BUDGET;
  const base = budget[market.toLowerCase()] ?? budget.default;
  return msToKickoff >= 0 && msToKickoff <= NEAR_KICKOFF_MS ? Math.round(base / 2) : base;
}

export type PriceState =
  /** Inside its freshness budget. Safe to show and to price a claim from. */
  | "fresh"
  /** Past budget but recent. Shown, marked, never used to support a value claim. */
  | "ageing"
  /** Too old to show as a current price. */
  | "stale"
  /** Explicitly expired by the provider or by `expires_at`. */
  | "expired"
  /** Kickoff has passed; a pre-match price is no longer a price at all. */
  | "closed";

/** Beyond this multiple of its budget, a price stops being shown. */
const STALE_MULTIPLE = 3;

export type PriceFacts = {
  sport: string;
  market: string;
  capturedAt: Date;
  expiresAt?: Date | null;
  kickoffAt: Date;
};

export type PriceAssessment = {
  state: PriceState;
  ageMs: number;
  budgetMs: number;
  /** Fresh prices only. Anything else must not back a value or edge claim. */
  supportsClaim: boolean;
};

export function priceState(facts: PriceFacts, now: Date): PriceAssessment {
  const ageMs = now.getTime() - facts.capturedAt.getTime();
  const msToKickoff = facts.kickoffAt.getTime() - now.getTime();
  const budgetMs = priceTtlMs(facts.sport, facts.market, msToKickoff);

  const assess = (state: PriceState): PriceAssessment => ({
    state,
    ageMs,
    budgetMs,
    supportsClaim: state === "fresh"
  });

  // Kickoff outranks age: a five-second-old price on a match already under way
  // is not a stale pre-match price, it is not a pre-match price at all.
  if (msToKickoff <= 0) return assess("closed");
  if (facts.expiresAt && facts.expiresAt.getTime() <= now.getTime()) return assess("expired");
  if (ageMs <= budgetMs) return assess("fresh");
  if (ageMs <= budgetMs * STALE_MULTIPLE) return assess("ageing");
  return assess("stale");
}

export const PRICE_COPY: Record<PriceState, string> = {
  fresh: "Live price",
  ageing: "Price may have moved",
  stale: "Price too old to show",
  expired: "Price withdrawn",
  closed: "Market closed"
};
