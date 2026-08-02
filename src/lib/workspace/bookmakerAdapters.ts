import type { OddsFormat } from "@/lib/workspace/selection";

/**
 * The contract a bookmaker-slip importer must satisfy.
 *
 * There is deliberately no generic "paste any slip" path. An importer that
 * half-understands a format produces legs pointing at the wrong fixture or the
 * wrong line, and the resulting analysis is confidently wrong — worse than no
 * import at all. Each adapter therefore declares exactly what it handles, and
 * the registry only claims what has been implemented and tested.
 */
export type ImportFailure =
  | { kind: "unsupported-format"; detail: string }
  | { kind: "unsupported-sport"; detail: string }
  | { kind: "unsupported-market"; detail: string }
  | { kind: "unresolved-fixture"; detail: string }
  | { kind: "unresolved-team"; detail: string }
  | { kind: "invalid-odds"; detail: string }
  | { kind: "malformed-input"; detail: string };

export type ImportedLeg = {
  /** Raw text the line came from, kept for the user to check against. */
  rawText: string;
  /** Provider-agnostic identifiers the resolver will canonicalise. */
  homeTeamName: string;
  awayTeamName: string;
  competitionName: string | null;
  marketHint: string;
  selectionHint: string;
  decimalOdds: number;
};

export type ImportResult =
  | { status: "parsed"; legs: ImportedLeg[]; warnings: string[] }
  | { status: "rejected"; failures: ImportFailure[] };

export type BookmakerAdapter = {
  id: string;
  displayName: string;
  /** What the adapter accepts. No adapter claims more than one. */
  inputFormat: "plain-text" | "csv" | "json";
  supportedSports: string[];
  /** Canonical market ids the adapter can produce. */
  supportedMarkets: string[];
  oddsFormat: OddsFormat;
  /** Human-readable statement of what this adapter does NOT handle. */
  limitations: string[];
  parse: (input: string) => ImportResult;
};

/**
 * Reference adapter: OddsPadi's own exported text format.
 *
 * Shipped because it is the one format that is fully specified and testable
 * today. It exists mainly to prove the interface; real bookmaker adapters are
 * added one at a time, each with its own tests.
 */
export const oddspadiTextAdapter: BookmakerAdapter = {
  id: "oddspadi-text",
  displayName: "OddsPadi exported slip",
  inputFormat: "plain-text",
  supportedSports: ["football"],
  supportedMarkets: ["match_winner", "over_under_25", "btts"],
  oddsFormat: "decimal",
  limitations: [
    "Football only.",
    "Match winner, over/under 2.5 and both teams to score only.",
    "Decimal odds only.",
    "Does not resolve teams by nickname or abbreviation."
  ],
  parse(input: string): ImportResult {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return { status: "rejected", failures: [{ kind: "malformed-input", detail: "The pasted slip was empty." }] };
    }

    const legs: ImportedLeg[] = [];
    const failures: ImportFailure[] = [];
    const warnings: string[] = [];

    for (const line of lines) {
      // Format: Home vs Away | competition | market | selection | odds
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 5) {
        failures.push({ kind: "malformed-input", detail: `Could not read this line: "${line}"` });
        continue;
      }
      const [teams, competition, market, selection, oddsText] = parts as [string, string, string, string, string];
      const teamMatch = /^(.+?)\s+vs\.?\s+(.+)$/i.exec(teams);
      if (!teamMatch) {
        failures.push({ kind: "unresolved-team", detail: `Could not identify both teams in "${teams}".` });
        continue;
      }
      if (!this.supportedMarkets.includes(market)) {
        failures.push({ kind: "unsupported-market", detail: `${market} is not one of the markets this importer handles.` });
        continue;
      }
      const decimalOdds = Number(oddsText);
      if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
        failures.push({ kind: "invalid-odds", detail: `"${oddsText}" is not a valid decimal price.` });
        continue;
      }
      if (!competition) warnings.push(`No competition given for ${teams}; fixture resolution may be ambiguous.`);

      legs.push({
        rawText: line,
        homeTeamName: teamMatch[1]!.trim(),
        awayTeamName: teamMatch[2]!.trim(),
        competitionName: competition || null,
        marketHint: market,
        selectionHint: selection,
        decimalOdds
      });
    }

    // Partial success is not success: a slip where two of five legs parsed
    // would be analysed as a different bet from the one the user pasted.
    if (failures.length) return { status: "rejected", failures };
    return { status: "parsed", legs, warnings };
  }
};

const ADAPTERS: BookmakerAdapter[] = [oddspadiTextAdapter];

export function listSupportedImports(): Array<Pick<BookmakerAdapter, "id" | "displayName" | "supportedSports" | "supportedMarkets" | "limitations">> {
  return ADAPTERS.map(({ id, displayName, supportedSports, supportedMarkets, limitations }) => ({
    id,
    displayName,
    supportedSports,
    supportedMarkets,
    limitations
  }));
}

export function importWithAdapter(adapterId: string, input: string): ImportResult {
  const adapter = ADAPTERS.find((entry) => entry.id === adapterId);
  if (!adapter) {
    return {
      status: "rejected",
      failures: [
        {
          kind: "unsupported-format",
          detail: `No importer is available for "${adapterId}". OddsPadi supports ${ADAPTERS.map((entry) => entry.displayName).join(", ") || "no imports"} today.`
        }
      ]
    };
  }
  return adapter.parse(input);
}
