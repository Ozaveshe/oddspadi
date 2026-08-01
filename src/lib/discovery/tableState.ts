/**
 * Official standings and model projections, kept apart.
 *
 * Before a season starts every team has played nothing: identical zero
 * records. Sorting that by "points, then goal difference" produces a table
 * where somebody is 1st and somebody is 20th, and a reader has no way to know
 * the order is an artefact of the sort rather than a standing. That is the
 * specific defect this module removes.
 *
 * Projections are never blended into the official table. A simulated point is
 * not a point.
 */
export type StandingRow = {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

export type OfficialTable =
  | {
      state: "season-not-started";
      /** Alphabetical: an ordering that makes no claim about merit. */
      rows: StandingRow[];
      label: string;
      note: string;
    }
  | {
      state: "in-progress";
      /** Ranked by the competition's real rules. */
      rows: Array<StandingRow & { position: number }>;
      label: string;
      matchesPlayed: number;
      /** When the underlying results were last verified. */
      verifiedAt: string | null;
    }
  | { state: "unavailable"; label: string; note: string };

export type ProjectedTable = {
  /** Always labelled a simulation, never a standing. */
  kind: "simulation";
  competition: string;
  modelVersion: string;
  evidenceDate: string;
  simulationCount: number;
  /** Inputs the projection is knowingly missing. */
  knownMissingInputs: string[];
  lastUpdatedAt: string;
  rows: Array<{ teamName: string; titleProbability: number; top4Probability: number; relegationProbability: number }>;
};

/**
 * Build the official table.
 *
 * The pre-season branch is not a special case bolted on — it is the correct
 * representation of "no matches have been played", and any table that shows
 * ranks without results is asserting something it cannot support.
 */
export function buildOfficialTable(
  rows: StandingRow[] | null,
  { verifiedAt = null }: { verifiedAt?: string | null } = {}
): OfficialTable {
  if (rows === null) {
    return {
      state: "unavailable",
      label: "Table unavailable",
      note: "The official standings could not be read. No positions are shown rather than positions we cannot verify."
    };
  }

  const matchesPlayed = rows.reduce((sum, row) => sum + row.played, 0);
  if (matchesPlayed === 0) {
    return {
      state: "season-not-started",
      // Alphabetical, so no reader can mistake row order for a ranking.
      rows: [...rows].sort((left, right) => left.teamName.localeCompare(right.teamName)),
      label: "Season not started",
      note: "No matches have been played, so there are no standings yet. Teams are listed alphabetically."
    };
  }

  const ranked = [...rows]
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.goalsFor - right.goalsAgainst - (left.goalsFor - left.goalsAgainst) ||
        right.goalsFor - left.goalsFor ||
        left.teamName.localeCompare(right.teamName)
    )
    .map((row, index) => ({ ...row, position: index + 1 }));

  return { state: "in-progress", rows: ranked, label: "Official table", matchesPlayed, verifiedAt };
}

/** Copy for the projection block, so no surface invents its own wording. */
export function projectionDisclosure(projection: ProjectedTable): string {
  const missing = projection.knownMissingInputs.length
    ? ` Known gaps: ${projection.knownMissingInputs.join(", ")}.`
    : "";
  return (
    `Simulated ${projection.simulationCount.toLocaleString()} times by ${projection.modelVersion} using evidence to ` +
    `${projection.evidenceDate}. These are probabilities, not standings, and no simulated point appears in the official table.${missing}`
  );
}

/**
 * Guard against the two tables being merged by a caller.
 *
 * Returned as data rather than thrown so a page can render the official table
 * and drop the projection, instead of failing entirely.
 */
export function assertTablesSeparate(official: OfficialTable, projection: ProjectedTable | null): string[] {
  const problems: string[] = [];
  if (!projection) return problems;
  if (projection.kind !== "simulation") problems.push("projection is not labelled as a simulation");
  if (official.state === "season-not-started" && official.rows.some((row) => row.points > 0)) {
    problems.push("a pre-season table carries points");
  }
  if (!projection.modelVersion || !projection.evidenceDate) {
    problems.push("projection is missing its model version or evidence date");
  }
  return problems;
}
