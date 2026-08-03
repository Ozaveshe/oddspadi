import type { BandEvidence } from "@/lib/accumulator/calibratedBands";
import { assessBand, bandFor } from "@/lib/accumulator/calibratedBands";

/**
 * Choosing what to publish, from everything that qualified.
 *
 * The operating policy is "everything that clears the gates", with no daily
 * cap. Taken literally that is not implementable: measured on 2026-08-03,
 * 17,418 decisions cleared the numeric gate in 24 hours across only 346
 * distinct fixture-markets — roughly fifty rows each, because the count
 * includes every *selection* within a market. 580 of them were rival selections
 * inside the same market, each claiming positive edge.
 *
 * Publishing all of them would put both sides of the same bet in the ledger,
 * which the one-live-claim-per-(fixture, market, selection) index forbids and
 * the reconciler flags as critical. So the only coherent reading of "no cap" is
 * the best selection per fixture-market, and that is what this does: no
 * artificial daily limit, one claim per market, nothing self-contradictory.
 */

export type PublicationCandidate = {
  fixtureId: string;
  fixtureExternalId: string;
  sport: string;
  competition: string;
  kickoffAt: string;
  market: string;
  selection: string;
  selectionLabel: string;
  marketLine: number | null;
  modelProbability: number;
  impliedProbability: number;
  /** Margin-free market probability. Required: edge against a vigged price is partly vig. */
  noVigProbability: number | null;
  decimalOdds: number;
  oddsSnapshotId: string | null;
  oddsSnapshotAt: string;
  evidenceCutoffAt: string;
  dataQuality: "complete" | "partial" | "stale" | "unavailable" | "confirmed_empty";
  modelVersion: string;
  featureSetVersion: string;
  calibrationVersion: string;
  decisionPolicyVersion: string;
  bookmakerCount: number;
};

export type RejectedCandidate = { candidate: PublicationCandidate; reason: string };

export type PublicationSelection = {
  selected: PublicationCandidate[];
  rejected: RejectedCandidate[];
  /** Distinct fixtures represented in the selection. */
  fixtures: number;
};

/** Edge measured against the margin-free price, never the quoted one. */
export function edgeOf(candidate: PublicationCandidate): number | null {
  if (candidate.noVigProbability === null) return null;
  return candidate.modelProbability - candidate.noVigProbability;
}

/**
 * Filter to publishable candidates, then keep the best per fixture-market.
 *
 * "Best" is the largest edge. Ties break on the higher model probability, so a
 * coin-flip between two equal edges resolves toward the outcome the model is
 * more confident about rather than toward whichever row the database returned
 * first — a non-deterministic ledger would be its own problem.
 */
export function selectForPublication({
  candidates,
  bandsBySport,
  approvedSports,
  now
}: {
  candidates: PublicationCandidate[];
  bandsBySport: Record<string, BandEvidence[]>;
  /** Sports with a live approved promotion. Anything else cannot publish. */
  approvedSports: Set<string>;
  now: Date;
}): PublicationSelection {
  const rejected: RejectedCandidate[] = [];
  const bestByMarket = new Map<string, PublicationCandidate>();

  for (const candidate of candidates) {
    const reject = (reason: string) => rejected.push({ candidate, reason });

    if (!approvedSports.has(candidate.sport)) {
      reject(`no approved calibration promotion for ${candidate.sport}`);
      continue;
    }
    // A pick published after kickoff is not a forecast. The database refuses it
    // too; catching it here keeps the run's report readable.
    if (Date.parse(candidate.kickoffAt) <= now.getTime()) {
      reject("kickoff has passed");
      continue;
    }
    if (!(candidate.decimalOdds > 1)) {
      reject("no usable price");
      continue;
    }
    const edge = edgeOf(candidate);
    if (edge === null) {
      reject("no margin-free price, so edge cannot be separated from the bookmaker's margin");
      continue;
    }

    const bands = bandsBySport[candidate.sport] ?? [];
    const band = bands.length ? bandFor(candidate.modelProbability, bands) : null;
    if (!band) {
      reject("no calibration band covers this probability");
      continue;
    }
    const verdict = assessBand(band);
    if (!verdict.supported) {
      reject(verdict.reason);
      continue;
    }
    if (edge <= verdict.edgePremium) {
      reject(`edge ${(edge * 100).toFixed(1)}% does not clear the ${(verdict.edgePremium * 100).toFixed(1)}% premium this band carries`);
      continue;
    }

    const key = `${candidate.fixtureId}::${candidate.market}`;
    const incumbent = bestByMarket.get(key);
    if (!incumbent) {
      bestByMarket.set(key, candidate);
      continue;
    }
    const incumbentEdge = edgeOf(incumbent) ?? -Infinity;
    const better =
      edge > incumbentEdge ||
      (edge === incumbentEdge && candidate.modelProbability > incumbent.modelProbability);
    if (better) {
      bestByMarket.set(key, candidate);
      reject(`superseded within ${candidate.market} by a larger edge`);
    } else {
      reject(`another selection in ${candidate.market} carries a larger edge`);
    }
  }

  const selected = [...bestByMarket.values()].sort((a, b) => (edgeOf(b) ?? 0) - (edgeOf(a) ?? 0));
  return {
    selected,
    rejected,
    fixtures: new Set(selected.map((candidate) => candidate.fixtureId)).size
  };
}
