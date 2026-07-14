import {
  calculateBookmakerMargin,
  decimalOddsToImpliedProbability,
  removeBookmakerMargin
} from "@/lib/sports/prediction/odds";

export type FootballHistoricalOutcome = "home" | "draw" | "away";

export type HistoricalFootballOddsQuote = {
  market: "match_winner";
  selection: FootballHistoricalOutcome;
  decimalOdds: number;
  isClosing?: boolean;
  observedAt?: string | null;
  bookmaker?: string | null;
};

export type CoherentFootballOddsSnapshot = {
  bookmaker: string;
  observedAt: string;
  observedAtMs: number;
  kind: "decision" | "closing";
  odds: Record<FootballHistoricalOutcome, number>;
  noVigProbabilities: Record<FootballHistoricalOutcome, number>;
  bookmakerMargin: number;
};

export type HistoricalFootballOddsAudit = {
  status: "ready" | "decision-only" | "no-coherent-decision";
  inputQuotes: number;
  validPreMatchQuotes: number;
  coherentDecisionSnapshots: number;
  coherentClosingSnapshots: number;
  rejectedQuotes: number;
  rejectedGroups: number;
  reason: string;
};

export type HistoricalFootballOddsResolution = {
  decisionSnapshot: CoherentFootballOddsSnapshot | null;
  closingSnapshot: CoherentFootballOddsSnapshot | null;
  audit: HistoricalFootballOddsAudit;
};

type SnapshotGroup = {
  bookmaker: string;
  observedAt: string;
  observedAtMs: number;
  kind: CoherentFootballOddsSnapshot["kind"];
  selections: Map<FootballHistoricalOutcome, number>;
  conflictingDuplicate: boolean;
};

const OUTCOMES = ["home", "draw", "away"] as const;

function finiteTimestamp(value: string | null | undefined): { iso: string; time: number } | null {
  if (!value?.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { iso: new Date(time).toISOString(), time } : null;
}

function snapshotFromGroup(group: SnapshotGroup): CoherentFootballOddsSnapshot | null {
  if (group.conflictingDuplicate || !OUTCOMES.every((selection) => group.selections.has(selection))) return null;
  const odds = Object.fromEntries(OUTCOMES.map((selection) => [selection, group.selections.get(selection)!])) as Record<
    FootballHistoricalOutcome,
    number
  >;
  const raw = OUTCOMES.map((selection) => decimalOddsToImpliedProbability(odds[selection]));
  const noVig = removeBookmakerMargin(raw);
  return {
    bookmaker: group.bookmaker,
    observedAt: group.observedAt,
    observedAtMs: group.observedAtMs,
    kind: group.kind,
    odds,
    noVigProbabilities: {
      home: noVig[0] ?? 0,
      draw: noVig[1] ?? 0,
      away: noVig[2] ?? 0
    },
    bookmakerMargin: calculateBookmakerMargin(raw)
  };
}

function snapshotPreference(left: CoherentFootballOddsSnapshot, right: CoherentFootballOddsSnapshot): number {
  if (left.observedAtMs !== right.observedAtMs) return right.observedAtMs - left.observedAtMs;
  const marginDifference = Math.abs(left.bookmakerMargin) - Math.abs(right.bookmakerMargin);
  return marginDifference || left.bookmaker.localeCompare(right.bookmaker);
}

/**
 * Resolve one auditable pre-match 1X2 market. A usable snapshot must contain
 * home, draw and away from the same bookmaker at the same observed timestamp.
 * Closing-line value additionally requires an explicit later closing snapshot
 * from that same bookmaker; ordinary last-seen quotes are never relabelled.
 */
export function resolveHistoricalFootballOdds(
  quotes: readonly HistoricalFootballOddsQuote[],
  { kickoffAt }: { kickoffAt: string }
): HistoricalFootballOddsResolution {
  const kickoff = Date.parse(kickoffAt);
  const groups = new Map<string, SnapshotGroup>();
  let validPreMatchQuotes = 0;
  let rejectedQuotes = 0;

  for (const quote of quotes) {
    const bookmaker = quote.bookmaker?.trim();
    const observed = finiteTimestamp(quote.observedAt);
    if (
      quote.market !== "match_winner" ||
      !OUTCOMES.includes(quote.selection) ||
      !Number.isFinite(quote.decimalOdds) ||
      quote.decimalOdds <= 1 ||
      !bookmaker ||
      !observed ||
      !Number.isFinite(kickoff) ||
      observed.time >= kickoff
    ) {
      rejectedQuotes += 1;
      continue;
    }

    validPreMatchQuotes += 1;
    const kind = quote.isClosing === true ? "closing" : "decision";
    const key = `${bookmaker.toLowerCase()}:${observed.iso}:${kind}`;
    const group = groups.get(key) ?? {
      bookmaker,
      observedAt: observed.iso,
      observedAtMs: observed.time,
      kind,
      selections: new Map<FootballHistoricalOutcome, number>(),
      conflictingDuplicate: false
    };
    const existing = group.selections.get(quote.selection);
    if (existing !== undefined && Math.abs(existing - quote.decimalOdds) > 0.0001) group.conflictingDuplicate = true;
    else group.selections.set(quote.selection, quote.decimalOdds);
    groups.set(key, group);
  }

  const coherent = [...groups.values()].flatMap((group) => {
    const snapshot = snapshotFromGroup(group);
    return snapshot ? [snapshot] : [];
  });
  const decisions = coherent.filter((snapshot) => snapshot.kind === "decision").sort(snapshotPreference);
  const decisionSnapshot = decisions[0] ?? null;
  const closings = coherent.filter((snapshot) => snapshot.kind === "closing");
  const closingSnapshot = decisionSnapshot
    ? closings
        .filter(
          (snapshot) =>
            snapshot.bookmaker.toLowerCase() === decisionSnapshot.bookmaker.toLowerCase() &&
            snapshot.observedAtMs > decisionSnapshot.observedAtMs
        )
        .sort(snapshotPreference)[0] ?? null
    : null;
  const rejectedGroups = groups.size - coherent.length;
  const status: HistoricalFootballOddsAudit["status"] = decisionSnapshot
    ? closingSnapshot
      ? "ready"
      : "decision-only"
    : "no-coherent-decision";
  const reason =
    status === "ready"
      ? `Using a complete ${decisionSnapshot!.bookmaker} decision snapshot and a later explicitly marked closing snapshot from the same bookmaker.`
      : status === "decision-only"
        ? `Using a complete ${decisionSnapshot!.bookmaker} decision snapshot; no later explicitly marked closing snapshot from the same bookmaker is available.`
        : "No complete pre-match home/draw/away snapshot from one bookmaker at one timestamp is available.";

  return {
    decisionSnapshot,
    closingSnapshot,
    audit: {
      status,
      inputQuotes: quotes.length,
      validPreMatchQuotes,
      coherentDecisionSnapshots: decisions.length,
      coherentClosingSnapshots: closings.length,
      rejectedQuotes,
      rejectedGroups,
      reason
    }
  };
}
