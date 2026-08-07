import { formatSelectionKey, parseSelectionKey } from "@/lib/markets/canonicalKey";

/**
 * Canonical market definitions.
 *
 * These live in code rather than in the database on purpose. Every field below
 * is settlement semantics, and settlement semantics that can be edited as data
 * can be changed between a publication and its result with nothing standing
 * between the edit and the record. A pull request is the review step. The
 * database gets a read-only mirror (`op_canonical_markets`) so the mapping
 * workbench can join impact queries in SQL, and a test asserts the mirror
 * matches this file.
 *
 * Definitions are append-only. A change to settlement meaning adds a new
 * `version` and leaves the old one in place, so a settlement recorded against
 * `2026-08-07.1` stays resolvable after `.2` exists. Editing a version in place
 * would silently restate what a historical claim meant, which is the failure
 * this whole design is built to prevent.
 */

export type CanonicalSport = "football" | "basketball" | "tennis";

/**
 * What the final score has to be read at for this market to resolve.
 *
 * Closed unions throughout this file, so an unhandled case is a compile error
 * rather than a default. A default here is a wrong verdict on a real claim.
 */
export type SettlementBasis =
  | "regulation"
  | "including_extra_time"
  | "including_shootout"
  | "full_game_including_ot"
  | "regulation_excluding_ot"
  | "sets"
  | "games"
  | "match_award";

export type OvertimeRule = "excluded" | "included" | "not_applicable";

export type PushRule =
  | "exact_line_push"
  | "half_line_no_push"
  | "quarter_line_half_push"
  | "no_push";

export type VoidRule = "void_on_no_result" | "void_on_abandonment" | "settle_if_awarded";

export type RetirementRule = "settle_on_award" | "void" | "not_applicable";

export type ParticipantScope = "match" | "team_home" | "team_away" | "player" | "either";

export type SelectionType = "binary" | "ternary" | "handicap" | "total" | "exact_score";

export type LineGranularity = "none" | "integer" | "half" | "quarter";

export type CanonicalSelection = {
  /** The trailing selection segment, e.g. `home`, `over`, `1x`, `player_a`. */
  id: string;
  label: string;
};

export type CanonicalMarket = {
  key: string;
  version: string;
  sport: CanonicalSport;
  family: string;
  period: string;
  participantScope: ParticipantScope;
  selectionType: SelectionType;
  lineRequired: boolean;
  lineGranularity: LineGranularity;
  basis: SettlementBasis;
  overtimeRule: OvertimeRule;
  pushRule: PushRule;
  voidRule: VoidRule;
  retirementRule: RetirementRule;
  /** Binds to the executable grade function in the settlement registry. */
  settlementRuleVersion: string;
  selections: CanonicalSelection[];
  /**
   * Plain-language statement of what the market resolves on. Rendered to
   * operators and analysts, so it must say the basis in words rather than
   * repeat the enum.
   */
  settlementBasisStatement: string;
};

const VERSION = "2026-08-07.1";

function market(definition: Omit<CanonicalMarket, "version" | "settlementRuleVersion">): CanonicalMarket {
  return { ...definition, version: VERSION, settlementRuleVersion: VERSION };
}

const HOME_AWAY: CanonicalSelection[] = [
  { id: "home", label: "Home" },
  { id: "away", label: "Away" }
];

const OVER_UNDER: CanonicalSelection[] = [
  { id: "over", label: "Over" },
  { id: "under", label: "Under" }
];

export const CANONICAL_MARKETS: CanonicalMarket[] = [
  // ---------------------------------------------------------------- football
  market({
    key: "football.1x2.regulation",
    sport: "football",
    family: "1x2",
    period: "regulation",
    participantScope: "match",
    selectionType: "ternary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: [
      { id: "home", label: "Home win" },
      { id: "draw", label: "Draw" },
      { id: "away", label: "Away win" }
    ],
    settlementBasisStatement:
      "Settles on the score at the end of normal time. Extra time and penalties are ignored, so a cup tie level after 90 minutes settles as a draw however it was eventually decided."
  }),
  market({
    key: "football.double_chance.regulation",
    sport: "football",
    family: "double_chance",
    period: "regulation",
    participantScope: "match",
    selectionType: "ternary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: [
      { id: "1x", label: "Home or draw" },
      { id: "12", label: "Home or away" },
      { id: "x2", label: "Draw or away" }
    ],
    settlementBasisStatement:
      "Settles on the score at the end of normal time; wins if either of the two covered outcomes occurs."
  }),
  market({
    key: "football.draw_no_bet.regulation",
    sport: "football",
    family: "draw_no_bet",
    period: "regulation",
    participantScope: "match",
    selectionType: "binary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: HOME_AWAY,
    settlementBasisStatement:
      "Settles on the score at the end of normal time. A draw returns the stake as a push."
  }),
  market({
    key: "football.asian_handicap.regulation",
    sport: "football",
    family: "asian_handicap",
    period: "regulation",
    participantScope: "match",
    selectionType: "handicap",
    lineRequired: true,
    lineGranularity: "quarter",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "quarter_line_half_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: HOME_AWAY,
    settlementBasisStatement:
      "The line is applied to the selection's normal-time score. A whole line landing exactly returns the stake; a quarter line splits the stake between the two neighbouring half lines, producing a half win or half loss."
  }),
  market({
    key: "football.total_goals.regulation",
    sport: "football",
    family: "total_goals",
    period: "regulation",
    participantScope: "match",
    selectionType: "total",
    lineRequired: true,
    lineGranularity: "quarter",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: OVER_UNDER,
    settlementBasisStatement:
      "Settles on total goals in normal time. A total landing exactly on a whole line returns the stake."
  }),
  market({
    key: "football.btts.regulation",
    sport: "football",
    family: "btts",
    period: "regulation",
    participantScope: "match",
    selectionType: "binary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "regulation",
    overtimeRule: "excluded",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: [
      { id: "yes", label: "Both teams to score" },
      { id: "no", label: "Not both teams to score" }
    ],
    settlementBasisStatement:
      "Settles on whether both teams scored in normal time."
  }),
  market({
    key: "football.to_qualify.including_shootout",
    sport: "football",
    family: "to_qualify",
    period: "including_shootout",
    participantScope: "match",
    selectionType: "binary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "including_shootout",
    overtimeRule: "included",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: HOME_AWAY,
    settlementBasisStatement:
      "Settles on which side advanced, counting extra time and a penalty shootout. This is the only football market here that reads past normal time."
  }),

  // -------------------------------------------------------------- basketball
  market({
    key: "basketball.moneyline.full_game_incl_ot",
    sport: "basketball",
    family: "moneyline",
    period: "full_game_incl_ot",
    participantScope: "match",
    selectionType: "binary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "full_game_including_ot",
    overtimeRule: "included",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: HOME_AWAY,
    settlementBasisStatement:
      "Settles on the final score including any overtime played. This is the market default; the regulation-only variant is a separate market, never a flag on this one."
  }),
  market({
    key: "basketball.moneyline.regulation",
    sport: "basketball",
    family: "moneyline",
    period: "regulation",
    participantScope: "match",
    selectionType: "ternary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "regulation_excluding_ot",
    overtimeRule: "excluded",
    pushRule: "no_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: [
      { id: "home", label: "Home win in regulation" },
      { id: "draw", label: "Tied after regulation" },
      { id: "away", label: "Away win in regulation" }
    ],
    settlementBasisStatement:
      "Settles on the score at the end of the fourth quarter, before any overtime. A game tied at that point settles the draw selection, which is why this market is three-way where the full-game market is two-way."
  }),
  market({
    key: "basketball.spread.full_game_incl_ot",
    sport: "basketball",
    family: "spread",
    period: "full_game_incl_ot",
    participantScope: "match",
    selectionType: "handicap",
    lineRequired: true,
    lineGranularity: "half",
    basis: "full_game_including_ot",
    overtimeRule: "included",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: HOME_AWAY,
    settlementBasisStatement:
      "The line is applied to the selection's final score including overtime. A margin landing exactly on a whole line returns the stake."
  }),
  market({
    key: "basketball.total_points.full_game_incl_ot",
    sport: "basketball",
    family: "total_points",
    period: "full_game_incl_ot",
    participantScope: "match",
    selectionType: "total",
    lineRequired: true,
    lineGranularity: "half",
    basis: "full_game_including_ot",
    overtimeRule: "included",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "not_applicable",
    selections: OVER_UNDER,
    settlementBasisStatement:
      "Settles on combined points including overtime. A total landing exactly on a whole line returns the stake."
  }),

  // ------------------------------------------------------------------ tennis
  market({
    key: "tennis.match_winner.full_match",
    sport: "tennis",
    family: "match_winner",
    period: "full_match",
    participantScope: "player",
    selectionType: "binary",
    lineRequired: false,
    lineGranularity: "none",
    basis: "match_award",
    overtimeRule: "not_applicable",
    pushRule: "no_push",
    voidRule: "settle_if_awarded",
    retirementRule: "settle_on_award",
    selections: [
      { id: "player_a", label: "Player A" },
      { id: "player_b", label: "Player B" }
    ],
    settlementBasisStatement:
      "Settles on the player awarded the match. A retirement still produces a winner and settles; a walkover, where no play took place, voids."
  }),
  market({
    key: "tennis.set_handicap.full_match",
    sport: "tennis",
    family: "set_handicap",
    period: "full_match",
    participantScope: "player",
    selectionType: "handicap",
    lineRequired: true,
    lineGranularity: "half",
    basis: "sets",
    overtimeRule: "not_applicable",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "void",
    selections: [
      { id: "player_a", label: "Player A" },
      { id: "player_b", label: "Player B" }
    ],
    settlementBasisStatement:
      "The line is applied to sets won in a completed match. A retirement voids, because the set count never reached its final value even though the match has a winner."
  }),
  market({
    key: "tennis.total_games.full_match",
    sport: "tennis",
    family: "total_games",
    period: "full_match",
    participantScope: "match",
    selectionType: "total",
    lineRequired: true,
    lineGranularity: "half",
    basis: "games",
    overtimeRule: "not_applicable",
    pushRule: "exact_line_push",
    voidRule: "void_on_no_result",
    retirementRule: "void",
    selections: OVER_UNDER,
    settlementBasisStatement:
      "Settles on total games in a completed match. A retirement voids, because games that would have been played were not."
  })
];

const BY_KEY = new Map(CANONICAL_MARKETS.map((entry) => [entry.key, entry]));

export function canonicalMarket(key: string): CanonicalMarket | null {
  return BY_KEY.get(key) ?? null;
}

export type CanonicalSelectionRef = {
  market: CanonicalMarket;
  selection: CanonicalSelection;
  line: number | null;
};

/**
 * Resolve a full selection key against the registry.
 *
 * Returns null for a key that is well-formed but unknown, or whose line does
 * not fit the market's granularity. `home.-0_3` is not an Asian handicap this
 * book supports, and rounding it to the nearest quarter would settle a claim
 * against a line nobody quoted.
 */
export function canonicalSelection(key: string): CanonicalSelectionRef | null {
  const parsed = parseSelectionKey(key);
  if (!parsed) return null;
  const market = BY_KEY.get(parsed.marketKey);
  if (!market) return null;
  const selection = market.selections.find((candidate) => candidate.id === parsed.selection);
  if (!selection) return null;
  if (market.lineRequired !== (parsed.line !== null)) return null;
  if (parsed.line !== null && !lineFitsGranularity(parsed.line, market.lineGranularity)) return null;
  return { market, selection, line: parsed.line };
}

export function lineFitsGranularity(line: number, granularity: LineGranularity): boolean {
  if (!Number.isFinite(line)) return false;
  switch (granularity) {
    case "none":
      return false;
    case "integer":
      return Number.isInteger(line);
    case "half":
      // Multiples of 0.5. Scaled to integers because 0.1 + 0.2 arithmetic makes
      // a modulo test on floats unreliable at exactly the values we care about.
      return Number.isInteger(line * 2);
    case "quarter":
      return Number.isInteger(line * 4);
  }
}

export function canonicalSelectionKeys(market: CanonicalMarket, line?: number | null): string[] {
  return market.selections.map((selection) => formatSelectionKey(market.key, selection.id, line));
}
