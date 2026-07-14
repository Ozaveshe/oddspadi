import type { CanonicalOddsSnapshot } from "./types";

export type OddsMovementPoint = {
  capturedAt: string;
  decimalOdds: number;
  bookmakerCount: number;
};

export type OddsMovementSeries = {
  selection: string;
  label: string;
  points: OddsMovementPoint[];
  openingOdds: number;
  latestOdds: number;
  movement: number;
};

const SELECTION_ORDER = ["home", "draw", "away", "yes", "no", "over_25", "under_25", "over", "under"];

function median(values: number[]): number {
  const ordered = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

export function buildOddsMovementSeries(
  snapshots: CanonicalOddsSnapshot[],
  market: string,
  maxSeries = 3
): OddsMovementSeries[] {
  const marketRows = snapshots.filter((snapshot) =>
    snapshot.market === market &&
    !snapshot.isLive &&
    snapshot.decimalOdds > 1 &&
    Number.isFinite(snapshot.decimalOdds) &&
    Number.isFinite(Date.parse(snapshot.capturedAt))
  );
  const selections = new Map<string, CanonicalOddsSnapshot[]>();
  for (const snapshot of marketRows) {
    selections.set(snapshot.selection, [...(selections.get(snapshot.selection) ?? []), snapshot]);
  }

  return [...selections.entries()]
    .sort(([left], [right]) => {
      const leftRank = SELECTION_ORDER.indexOf(left);
      const rightRank = SELECTION_ORDER.indexOf(right);
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank) || left.localeCompare(right);
    })
    .slice(0, Math.max(1, maxSeries))
    .flatMap(([selection, rows]) => {
      const byTimestamp = new Map<string, CanonicalOddsSnapshot[]>();
      for (const row of rows) byTimestamp.set(row.capturedAt, [...(byTimestamp.get(row.capturedAt) ?? []), row]);
      const points = [...byTimestamp.entries()]
        .map(([capturedAt, timestampRows]) => ({
          capturedAt,
          decimalOdds: median(timestampRows.map((row) => row.decimalOdds)),
          bookmakerCount: new Set(timestampRows.map((row) => row.bookmaker)).size
        }))
        .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
      if (!points.length) return [];
      const openingOdds = points[0].decimalOdds;
      const latestOdds = points.at(-1)!.decimalOdds;
      return [{
        selection,
        label: rows.find((row) => row.label)?.label ?? selection.replaceAll("_", " "),
        points,
        openingOdds,
        latestOdds,
        movement: latestOdds - openingOdds
      }];
    });
}
