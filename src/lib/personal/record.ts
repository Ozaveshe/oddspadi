import type { StoredWorkspace } from "@/lib/workspace/store";
import type { PersonalLegOutcome } from "@/lib/workspace/analysis";

/**
 * The personal analytical record: what the user's own settled selections say.
 *
 * Derived, never stored separately — the settled snapshots inside the user's
 * workspaces are the source of truth, so guest and account mode get the same
 * record from the same data, and deleting a workspace deletes its history.
 *
 * The one rule that shapes every surface showing this: **personal results
 * never mix with official model performance.** Different selections,
 * different prices, different discipline. `PERSONAL_RECORD_SEPARATION_COPY`
 * exists so every surface says so the same way.
 */

export const PERSONAL_RECORD_SEPARATION_COPY =
  "Your record reflects your own selections at your own odds. It is separate from the official OddsPadi track record, which only contains picks the model published in advance.";

export type PersonalRecordEntry = {
  workspaceId: string;
  workspaceName: string;
  legId: string;
  fixtureLabel: string;
  selectionLabel: string;
  sport: string | null;
  marketId: string;
  competition: string;
  odds: number;
  outcome: PersonalLegOutcome;
  /** Profit at one unit staked; null while pending or ungradeable. */
  oneUnitResult: number | null;
  settledAt: string | null;
  kickoffAt: string;
  note: string | null;
};

export type PersonalRecordBreakdown = {
  key: string;
  settled: number;
  wins: number;
  oneUnitTotal: number;
};

export type PersonalRecord = {
  entries: PersonalRecordEntry[];
  settledCount: number;
  pendingCount: number;
  wins: number;
  losses: number;
  /** Sum of one-unit results across settled, gradeable legs. */
  oneUnitTotal: number;
  bySport: PersonalRecordBreakdown[];
  byMarket: PersonalRecordBreakdown[];
  /** Signed streak: +3 = last three settled legs won, -2 = last two lost. */
  currentStreak: number;
};

function oneUnit(outcome: PersonalLegOutcome, odds: number): number | null {
  switch (outcome) {
    case "won":
      return odds - 1;
    case "half_won":
      return (odds - 1) / 2;
    case "half_lost":
      return -0.5;
    case "lost":
      return -1;
    case "push":
    case "void":
      return 0;
    case "needs_review":
    case "pending":
      return null;
  }
}

const COUNTED: ReadonlySet<PersonalLegOutcome> = new Set(["won", "half_won", "lost", "half_lost", "push", "void"]);

export function buildPersonalRecord(workspaces: StoredWorkspace[]): PersonalRecord {
  const entries: PersonalRecordEntry[] = [];

  for (const workspace of workspaces) {
    const settlement = workspace.snapshot?.settlement;
    const outcomeByLeg = new Map((settlement?.legOutcomes ?? []).map((entry) => [entry.legId, entry.outcome]));
    const source = workspace.snapshot ? workspace.snapshot.analysis.legs.map((leg) => leg.selection) : [];
    for (const selection of source) {
      const outcome = outcomeByLeg.get(selection.legId) ?? "pending";
      entries.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        legId: selection.legId,
        fixtureLabel: selection.fixtureLabel,
        selectionLabel: selection.label,
        sport: selection.sport ?? null,
        marketId: selection.marketId,
        competition: selection.competition,
        odds: selection.userOdds,
        outcome,
        oneUnitResult: oneUnit(outcome, selection.userOdds),
        settledAt: settlement?.settledAt ?? null,
        kickoffAt: selection.kickoffAt,
        note: selection.note ?? null
      });
    }
  }

  // Chronological by kickoff so the streak reads in playing order.
  entries.sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt));

  const settled = entries.filter((entry) => COUNTED.has(entry.outcome));
  const wins = settled.filter((entry) => entry.outcome === "won" || entry.outcome === "half_won").length;
  const losses = settled.filter((entry) => entry.outcome === "lost" || entry.outcome === "half_lost").length;
  const oneUnitTotal = settled.reduce((sum, entry) => sum + (entry.oneUnitResult ?? 0), 0);

  const breakdown = (key: (entry: PersonalRecordEntry) => string): PersonalRecordBreakdown[] => {
    const groups = new Map<string, PersonalRecordBreakdown>();
    for (const entry of settled) {
      const group = groups.get(key(entry)) ?? { key: key(entry), settled: 0, wins: 0, oneUnitTotal: 0 };
      group.settled += 1;
      if (entry.outcome === "won" || entry.outcome === "half_won") group.wins += 1;
      group.oneUnitTotal += entry.oneUnitResult ?? 0;
      groups.set(group.key, group);
    }
    return [...groups.values()].sort((left, right) => right.settled - left.settled);
  };

  // Streak over decisive outcomes only — a push neither extends nor breaks it.
  let currentStreak = 0;
  for (let index = settled.length - 1; index >= 0; index -= 1) {
    const outcome = settled[index]!.outcome;
    if (outcome === "push" || outcome === "void") continue;
    const winLike = outcome === "won" || outcome === "half_won";
    if (currentStreak === 0) currentStreak = winLike ? 1 : -1;
    else if (currentStreak > 0 && winLike) currentStreak += 1;
    else if (currentStreak < 0 && !winLike) currentStreak -= 1;
    else break;
  }

  return {
    entries,
    settledCount: settled.length,
    pendingCount: entries.length - settled.length,
    wins,
    losses,
    oneUnitTotal: Math.round(oneUnitTotal * 100) / 100,
    bySport: breakdown((entry) => entry.sport ?? "unknown"),
    byMarket: breakdown((entry) => entry.marketId),
    currentStreak
  };
}
