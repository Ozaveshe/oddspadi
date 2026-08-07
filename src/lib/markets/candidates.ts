import { CANONICAL_MARKETS, canonicalSelection, lineFitsGranularity, type CanonicalMarket } from "@/lib/markets/canonicalMarkets";
import { formatSelectionKey } from "@/lib/markets/canonicalKey";
import type { MarketAlias } from "@/lib/markets/alias";

/**
 * Suggest canonical mappings for a provider's raw market text.
 *
 * Suggestions only. The workbench shows these with the reason for each and an
 * analyst chooses; nothing here auto-approves, and a high score is an argument
 * rather than a decision. That distinction matters because the failure mode of
 * a good matcher is not being wrong — it is being right often enough that
 * somebody stops reading.
 *
 * Every candidate carries its reasons, so a reviewer can disagree with the
 * evidence rather than only with the conclusion.
 */

export type MappingCandidate = {
  canonicalSelectionKey: string;
  marketKey: string;
  confidence: number;
  reasons: string[];
  /** Settlement facts a reviewer should read before accepting. */
  basis: string;
  overtimeRule: string;
  retirementRule: string;
};

/** Provider vocabulary that maps to a canonical family with no ambiguity. */
const FAMILY_HINTS: Array<{ pattern: RegExp; family: string; reason: string }> = [
  { pattern: /\b(h2h|1x2|match[_ -]?winner|moneyline|money[_ -]?line|winner)\b/i, family: "1x2", reason: "market name is a match-winner synonym" },
  { pattern: /\b(double[_ -]?chance)\b/i, family: "double_chance", reason: "market name says double chance" },
  { pattern: /\b(draw[_ -]?no[_ -]?bet|dnb)\b/i, family: "draw_no_bet", reason: "market name says draw no bet" },
  { pattern: /\b(asian[_ -]?handicap|ah)\b/i, family: "asian_handicap", reason: "market name says Asian handicap" },
  { pattern: /\b(spread|point[_ -]?spread|handicap)\b/i, family: "spread", reason: "market name says spread or handicap" },
  { pattern: /\b(btts|both[_ -]?teams)\b/i, family: "btts", reason: "market name says both teams to score" },
  { pattern: /\b(total[_ -]?goals|over[_ -]?under|totals|goals)\b/i, family: "total_goals", reason: "market name says a goals total" },
  { pattern: /\b(total[_ -]?points|points)\b/i, family: "total_points", reason: "market name says a points total" },
  { pattern: /\b(total[_ -]?games|games)\b/i, family: "total_games", reason: "market name says a games total" },
  { pattern: /\b(set[_ -]?handicap|sets)\b/i, family: "set_handicap", reason: "market name says a set handicap" }
];

const SELECTION_HINTS: Array<{ pattern: RegExp; selection: string }> = [
  { pattern: /^(1|home|h)$/i, selection: "home" },
  { pattern: /^(x|draw|tie)$/i, selection: "draw" },
  { pattern: /^(2|away|a)$/i, selection: "away" },
  { pattern: /^(o|over)/i, selection: "over" },
  { pattern: /^(u|under)/i, selection: "under" },
  { pattern: /^(yes|y)$/i, selection: "yes" },
  { pattern: /^(no|n)$/i, selection: "no" },
  { pattern: /^1x$/i, selection: "1x" },
  { pattern: /^(12)$/i, selection: "12" },
  { pattern: /^(x2)$/i, selection: "x2" }
];

export type CandidateQuery = {
  sport: string;
  rawMarket: string;
  rawSelection: string;
  rawLine?: string | null;
  /** Aliases other providers already have, which are evidence for this one. */
  existingAliases?: MarketAlias[];
};

export function suggestCandidates(query: CandidateQuery): MappingCandidate[] {
  const sport = query.sport.trim().toLowerCase();
  const line = parseLine(query.rawLine);
  const candidates: MappingCandidate[] = [];

  const families = FAMILY_HINTS.filter((hint) => hint.pattern.test(query.rawMarket));
  const selectionHint = SELECTION_HINTS.find((hint) => hint.pattern.test(query.rawSelection.trim()));

  for (const market of CANONICAL_MARKETS) {
    if (market.sport !== sport) continue;
    const familyMatch = families.find((hint) => hint.family === market.family);
    if (!familyMatch) continue;

    const reasons = [familyMatch.reason];
    let confidence = 0.5;

    const selection = selectionHint?.selection ?? query.rawSelection.trim().toLowerCase();
    const known = market.selections.some((entry) => entry.id === selection);
    if (!known) continue;
    if (selectionHint) {
      confidence += 0.2;
      reasons.push(`selection "${query.rawSelection}" reads as ${selection}`);
    }

    if (market.lineRequired) {
      if (line === null) {
        // A market needing a line, from text carrying none, is not a candidate
        // with lower confidence — it is a mapping that cannot be completed.
        continue;
      }
      if (!lineFitsGranularity(line, market.lineGranularity)) {
        continue;
      }
      confidence += 0.15;
      reasons.push(`line ${line} fits this market's ${market.lineGranularity} granularity`);
    } else if (line !== null) {
      continue;
    }

    const key = formatSelectionKey(market.key, selection, market.lineRequired ? line : null);
    if (!canonicalSelection(key)) continue;

    const priorUse = (query.existingAliases ?? []).filter(
      (alias) => alias.canonicalSelectionKey === key && alias.status === "active"
    );
    if (priorUse.length > 0) {
      confidence += 0.15;
      reasons.push(`${priorUse.length} other provider mapping(s) already point here`);
    }

    candidates.push({
      canonicalSelectionKey: key,
      marketKey: market.key,
      confidence: Number(Math.min(0.95, confidence).toFixed(2)),
      reasons,
      basis: market.basis,
      overtimeRule: market.overtimeRule,
      retirementRule: market.retirementRule
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function parseLine(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Two markets' settlement rules, side by side.
 *
 * The workbench's `compare` view. Differences are listed explicitly rather than
 * left for a reader to spot between two columns — the whole reason Draw No Bet
 * and Asian Handicap 0 get confused is that the difference is one field among
 * several identical ones.
 */
export function compareSettlement(leftKey: string, rightKey: string): {
  left: CanonicalMarket | null;
  right: CanonicalMarket | null;
  differences: Array<{ field: string; left: string; right: string }>;
} {
  const left = CANONICAL_MARKETS.find((market) => market.key === leftKey) ?? null;
  const right = CANONICAL_MARKETS.find((market) => market.key === rightKey) ?? null;
  if (!left || !right) return { left, right, differences: [] };

  const fields: Array<keyof CanonicalMarket> = ["basis", "overtimeRule", "pushRule", "voidRule", "retirementRule", "period"];
  const differences = fields
    .filter((field) => left[field] !== right[field])
    .map((field) => ({ field: String(field), left: String(left[field]), right: String(right[field]) }));

  return { left, right, differences };
}
