/**
 * Language that promises an outcome. Shared by the source-copy scan
 * (consumer-copy-integrity) and the runtime gate on AI-polished editorial text,
 * so model output is held to the same standard as hand-written copy.
 */
export const BANNED_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bguaranteed\s+(win|profit|return|payout|outcome)/i, why: "promises an outcome" },
  { pattern: /\bsure\s+(bet|odds|thing|win|banker)/i, why: "promises an outcome" },
  { pattern: /\b(100|99)\s*%\s*(sure|certain|accurate|win)/i, why: "claims near-certainty" },
  { pattern: /\bcan(?:'|’)?t\s+lose\b|\bcannot\s+lose\b/i, why: "denies risk" },
  { pattern: /\brisk[- ]free\b/i, why: "denies risk" },
  { pattern: /\bfixed\s+match/i, why: "implies corruption" },
  { pattern: /\bwin(?:ning)?\s+every\s+(day|time|week)\b/i, why: "promises a run" },
  { pattern: /\beasy\s+money\b/i, why: "trivialises loss" },
  { pattern: /\bnever\s+lose[s]?\b/i, why: "denies risk" },
  { pattern: /\bjackpot\s+guarantee/i, why: "promises an outcome" }
];

/**
 * A negation directly before the phrase flips its meaning ("not guaranteed",
 * "never promise sure odds") — that is the product saying the right thing.
 */
export const NEGATED_BEFORE = /\b(not|never|no|isn(?:'|’)?t|aren(?:'|’)?t|without|don(?:'|’)?t|doesn(?:'|’)?t|rather than|instead of)\b[^.]{0,40}$/i;

/**
 * Does this text make a prohibited claim (ignoring negated mentions)?
 * Used to reject AI-polished output before it can be published.
 */
export function makesProhibitedClaim(text: string): boolean {
  for (const { pattern } of BANNED_CLAIMS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const preceding = text.slice(0, match.index);
    if (NEGATED_BEFORE.test(preceding)) continue;
    return true;
  }
  return false;
}
