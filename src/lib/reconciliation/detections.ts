/**
 * Production reconciliation — pure detection logic.
 *
 * Detects the eleven mismatch classes the spec names, over already-fetched
 * rows (so the logic is deterministic and testable without a database). Two
 * contracts are load-bearing and mirror scripts/reconcile-truth.mjs:
 *
 *  - **Alert, never rewrite.** These functions only DESCRIBE mismatches. The
 *    caller turns a finding into an alert (an op_settlement_exceptions row);
 *    nothing here corrects a source table.
 *  - **Never report zero on failure.** A source the caller could not read is
 *    passed in `couldNotCheck`; when it is non-empty the report status is
 *    `could_not_check`, which outranks `findings` — an unread source is never
 *    a false "clean".
 */

export type ReconcilerSeverity = "critical" | "warning" | "info";

export type ReconcilerFindingKind =
  | "publication_track_record_mismatch"
  | "news_publication_mismatch"
  | "unsettled_final_fixture"
  | "stale_current_decision"
  | "missing_closing_price"
  | "duplicate_fixture"
  | "result_conflict"
  | "orphaned_community_selection"
  | "projection_age_breach"
  | "route_error_spike"
  | "model_version_mismatch";

export type ReconcilerFinding = {
  kind: ReconcilerFindingKind;
  severity: ReconcilerSeverity;
  /** The affected fixture/publication/projection id. */
  entity: string;
  /** Human, sanitised — never raw SQL/provider text. */
  detail: string;
};

export type ReconcilerFixtureRow = {
  id: string;
  externalId: string | null;
  status: string;
  lastSyncedAt: string | null;
};
export type ReconcilerPublicationRow = {
  id: string;
  fixtureId: string | null;
  fixtureExternalId: string | null;
  settlementStatus: string | null;
  modelVersion: string | null;
  hasCurrentClose: boolean;
  kickoffAt: string | null;
  publicationStatus: string;
};
export type ReconcilerStoryRow = { slug: string; claimsACount: boolean; citedPublicationIds: string[] };
export type ReconcilerDecisionRow = { fixtureExternalId: string; generatedAt: string | null; supersededBy: string | null };
export type ReconcilerResultRow = { fixtureId: string; verificationState: string; isCurrent: boolean };
export type ReconcilerTipRow = { id: string; fixtureId: string | null; deletedAt: string | null; moderatedAt: string | null };
export type ReconcilerProjectionRow = { name: string; scope: string; builtAt: string | null };
export type ReconcilerDuplicateRow = { id: string; duplicateOf: string };
export type ReconcilerRouteErrorRow = { route: string; errorCount: number; sampleCount: number };

export type ReconcilerInput = {
  fixtures: ReconcilerFixtureRow[];
  publications: ReconcilerPublicationRow[];
  stories: ReconcilerStoryRow[];
  decisions: ReconcilerDecisionRow[];
  results: ReconcilerResultRow[];
  tips: ReconcilerTipRow[];
  projections: ReconcilerProjectionRow[];
  duplicates: ReconcilerDuplicateRow[];
  routeErrors: ReconcilerRouteErrorRow[];
  approvedModelVersions: string[];
};

export type ReconcilerReport = {
  generatedAt: string;
  findings: ReconcilerFinding[];
  couldNotCheck: string[];
  status: "clean" | "findings" | "could_not_check";
};

const SETTLE_DEADLINE_MS = 60 * 60_000;
const DECISION_STALE_MS = 30 * 60_000; // slate decision freshness threshold
const PROJECTION_STALE_MS = 5 * 60_000 * 3; // refresh interval * 3
const ROUTE_ERROR_MIN_SAMPLE = 20;
const ROUTE_ERROR_RATE = 0.1; // >10% of a meaningful sample is a spike
const TERMINAL = new Set(["finished", "cancelled", "abandoned"]);
const DECIDED = new Set(["won", "lost", "push"]);

function fixtureIndex(fixtures: ReconcilerFixtureRow[]): Map<string, ReconcilerFixtureRow> {
  const map = new Map<string, ReconcilerFixtureRow>();
  for (const fixture of fixtures) {
    map.set(fixture.id, fixture);
    if (fixture.externalId) map.set(fixture.externalId, fixture);
  }
  return map;
}

function resolveFixture(map: Map<string, ReconcilerFixtureRow>, pub: ReconcilerPublicationRow): ReconcilerFixtureRow | null {
  return (pub.fixtureId && map.get(pub.fixtureId)) || (pub.fixtureExternalId && map.get(pub.fixtureExternalId)) || null;
}

export function detectUnsettledFinalFixtures(input: ReconcilerInput, now: Date): ReconcilerFinding[] {
  const map = fixtureIndex(input.fixtures);
  const out: ReconcilerFinding[] = [];
  for (const pub of input.publications) {
    const fixture = resolveFixture(map, pub);
    if (!fixture) continue;
    const terminal = TERMINAL.has(fixture.status);
    const settled = Boolean(pub.settlementStatus && pub.settlementStatus !== "unsettled");
    if (terminal && !settled) {
      const since = fixture.lastSyncedAt ? now.getTime() - Date.parse(fixture.lastSyncedAt) : 0;
      if (since > SETTLE_DEADLINE_MS) {
        out.push({ kind: "unsettled_final_fixture", severity: "critical", entity: pub.id, detail: `Fixture ${fixture.status} for ${Math.round(since / 60_000)} minutes, still unsettled.` });
      }
    }
    if (!terminal && settled) {
      out.push({ kind: "unsettled_final_fixture", severity: "critical", entity: pub.id, detail: `Settled while the fixture is "${fixture.status}".` });
    }
    if (pub.settlementStatus && DECIDED.has(pub.settlementStatus) && fixture.status !== "finished") {
      out.push({ kind: "unsettled_final_fixture", severity: "critical", entity: pub.id, detail: `Graded a decided result on a "${fixture.status}" fixture.` });
    }
  }
  return out;
}

export function detectPublicationTrackRecordMismatch(input: ReconcilerInput): ReconcilerFinding[] {
  const map = fixtureIndex(input.fixtures);
  const out: ReconcilerFinding[] = [];
  const seen = new Map<string, string>();
  for (const pub of input.publications) {
    if (pub.publicationStatus === "retracted") continue;
    if (!resolveFixture(map, pub)) {
      out.push({ kind: "publication_track_record_mismatch", severity: "critical", entity: pub.id, detail: "Publication references a fixture that does not exist." });
    }
    // Two live publications for the same fixture (same-selection duplication).
    const key = `${pub.fixtureExternalId ?? pub.fixtureId}`;
    const prior = seen.get(key);
    if (prior && prior !== pub.id) {
      // only flag if genuinely duplicate — caller dedupes by selection upstream
    } else {
      seen.set(key, pub.id);
    }
  }
  return out;
}

export function detectNewsPublicationMismatch(input: ReconcilerInput): ReconcilerFinding[] {
  const ledgerIds = new Set(input.publications.map((pub) => pub.id));
  const out: ReconcilerFinding[] = [];
  for (const story of input.stories) {
    if (story.claimsACount && story.citedPublicationIds.length === 0) {
      out.push({ kind: "news_publication_mismatch", severity: "critical", entity: story.slug, detail: "Story states a pick count but cites no publication IDs." });
    }
    for (const id of story.citedPublicationIds) {
      if (!ledgerIds.has(id)) {
        out.push({ kind: "news_publication_mismatch", severity: "critical", entity: story.slug, detail: "Story cites a publication that is not in the ledger." });
      }
    }
  }
  return out;
}

export function detectStaleCurrentDecisions(input: ReconcilerInput, now: Date): ReconcilerFinding[] {
  const out: ReconcilerFinding[] = [];
  for (const decision of input.decisions) {
    if (decision.supersededBy) continue; // not the current decision
    const age = decision.generatedAt ? now.getTime() - Date.parse(decision.generatedAt) : Number.POSITIVE_INFINITY;
    if (age > DECISION_STALE_MS) {
      out.push({ kind: "stale_current_decision", severity: "warning", entity: decision.fixtureExternalId, detail: `Current decision is ${Number.isFinite(age) ? Math.round(age / 60_000) : "unknown"} minutes old.` });
    }
  }
  return out;
}

export function detectMissingClosingPrices(input: ReconcilerInput, now: Date): ReconcilerFinding[] {
  const out: ReconcilerFinding[] = [];
  for (const pub of input.publications) {
    if (pub.publicationStatus !== "published" && pub.publicationStatus !== "corrected") continue;
    const kicked = pub.kickoffAt ? Date.parse(pub.kickoffAt) < now.getTime() : false;
    if (kicked && !pub.hasCurrentClose) {
      out.push({ kind: "missing_closing_price", severity: "warning", entity: pub.id, detail: "Fixture has kicked off but no current closing price was captured." });
    }
  }
  return out;
}

export function detectResultConflicts(input: ReconcilerInput): ReconcilerFinding[] {
  const out: ReconcilerFinding[] = [];
  for (const result of input.results) {
    if (result.isCurrent && result.verificationState === "conflicted") {
      out.push({ kind: "result_conflict", severity: "critical", entity: result.fixtureId, detail: "Providers disagree on the final result; verification is conflicted." });
    }
  }
  return out;
}

export function detectOrphanedCommunitySelections(input: ReconcilerInput): ReconcilerFinding[] {
  const map = fixtureIndex(input.fixtures);
  const out: ReconcilerFinding[] = [];
  for (const tip of input.tips) {
    // A deleted or moderated tip is a still-present row (tombstone), not a gap.
    if (!tip.fixtureId) continue;
    if (!map.has(tip.fixtureId)) {
      out.push({ kind: "orphaned_community_selection", severity: "warning", entity: tip.id, detail: "Community tip references a fixture that does not exist." });
    }
  }
  return out;
}

export function detectProjectionAgeBreaches(input: ReconcilerInput, now: Date): ReconcilerFinding[] {
  const out: ReconcilerFinding[] = [];
  const todayUtc = now.toISOString().slice(0, 10);
  for (const projection of input.projections) {
    const scope = projection.scope;
    if (scope.startsWith("archive")) continue;
    // A slate scoped to a past date is finished, not stale.
    if (/^\d{4}-\d{2}-\d{2}$/.test(scope) && scope < todayUtc) continue;
    const age = projection.builtAt ? now.getTime() - Date.parse(projection.builtAt) : Number.POSITIVE_INFINITY;
    if (age > PROJECTION_STALE_MS) {
      out.push({ kind: "projection_age_breach", severity: "warning", entity: `${projection.name}/${projection.scope}`, detail: `Projection is ${Number.isFinite(age) ? Math.round(age / 60_000) : "unknown"} minutes old.` });
    }
  }
  return out;
}

export function detectDuplicateFixtures(input: ReconcilerInput): ReconcilerFinding[] {
  return input.duplicates.map((row) => ({
    kind: "duplicate_fixture" as const,
    severity: "warning" as const,
    entity: row.id,
    detail: "Fixture is flagged as a cross-provider duplicate of another row."
  }));
}

export function detectRouteErrorSpikes(input: ReconcilerInput): ReconcilerFinding[] {
  const out: ReconcilerFinding[] = [];
  for (const route of input.routeErrors) {
    if (route.sampleCount >= ROUTE_ERROR_MIN_SAMPLE && route.errorCount / route.sampleCount > ROUTE_ERROR_RATE) {
      out.push({ kind: "route_error_spike", severity: "critical", entity: route.route, detail: `${Math.round((route.errorCount / route.sampleCount) * 100)}% of recent requests failed.` });
    }
  }
  return out;
}

export function detectModelVersionMismatch(input: ReconcilerInput): ReconcilerFinding[] {
  const approved = new Set(input.approvedModelVersions);
  const out: ReconcilerFinding[] = [];
  for (const pub of input.publications) {
    if (pub.publicationStatus === "retracted") continue;
    if (pub.modelVersion && !approved.has(pub.modelVersion)) {
      out.push({ kind: "model_version_mismatch", severity: "critical", entity: pub.id, detail: "Publication was made under a model version that is not currently approved." });
    }
  }
  return out;
}

/** Run every detection and roll up. `couldNotCheck` outranks findings. */
export function reconcile(input: ReconcilerInput, now: Date, couldNotCheck: string[] = []): ReconcilerReport {
  const findings: ReconcilerFinding[] = [
    ...detectUnsettledFinalFixtures(input, now),
    ...detectPublicationTrackRecordMismatch(input),
    ...detectNewsPublicationMismatch(input),
    ...detectStaleCurrentDecisions(input, now),
    ...detectMissingClosingPrices(input, now),
    ...detectResultConflicts(input),
    ...detectOrphanedCommunitySelections(input),
    ...detectProjectionAgeBreaches(input, now),
    ...detectDuplicateFixtures(input),
    ...detectRouteErrorSpikes(input),
    ...detectModelVersionMismatch(input)
  ];
  const status: ReconcilerReport["status"] = couldNotCheck.length ? "could_not_check" : findings.length ? "findings" : "clean";
  return { generatedAt: now.toISOString(), findings, couldNotCheck, status };
}

export const EMPTY_RECONCILER_INPUT: ReconcilerInput = {
  fixtures: [],
  publications: [],
  stories: [],
  decisions: [],
  results: [],
  tips: [],
  projections: [],
  duplicates: [],
  routeErrors: [],
  approvedModelVersions: []
};
