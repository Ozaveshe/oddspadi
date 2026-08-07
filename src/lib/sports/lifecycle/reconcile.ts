import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { type FixtureLifecycleState, fixtureLifecycle } from "./fixtureState";

/**
 * Bring stored fixture status back into agreement with the evidence.
 *
 * This runs the *same* `fixtureLifecycle` the read path uses, which is the
 * whole point: the previous arrangement had the sweep encode its rules in SQL
 * and the pages encode theirs in TypeScript, so "is this match over?" had two
 * answers that drifted apart between deploys.
 *
 * Three properties the brief asks for, and how each is met:
 *
 * **Idempotent.** A transition is written only when the derived state differs
 * from the stored one, so a second run over unchanged data writes nothing. Safe
 * to run on a schedule and safe to re-run after a partial failure.
 *
 * **Auditable.** Every correction appends to
 * `op_fixture_lifecycle_transitions` with the basis and how overdue the fixture
 * was. Writing the reason onto the fixture row, as the old sweep did, meant the
 * second correction erased the first.
 *
 * **Non-destructive.** Nothing is deleted and nothing is marked finished on
 * inference. A fixture past its window with no evidence becomes `unresolved` —
 * quarantined, still queryable, still able to be resolved by a later provider
 * read. `unresolved` is deliberately not terminal.
 */

/**
 * Lifecycle states that hold a fixture out of settlement.
 *
 * These mirror `QUARANTINED_LIFECYCLE_STATES` in `settlePublications.ts`, and
 * the pairing is the point: a state that blocks settlement is exactly a state
 * the reconciler must keep revisiting, because nothing else will ever let the
 * fixture out. A test asserts the two sets agree.
 */
export const QUARANTINED_STATES: ReadonlySet<FixtureLifecycleState> = new Set([
  "unresolved",
  "due",
  "suspended"
]);

export type ReconciliationChange = {
  fixtureId: string;
  sport: string;
  from: string;
  to: FixtureLifecycleState;
  basis: string;
  overdueHours: number;
};

export type ReconciliationReport = {
  status: "completed" | "preview" | "unavailable";
  committed: boolean;
  generatedAt: string;
  scanned: number;
  changes: ReconciliationChange[];
  bySport: { sport: string; scanned: number; changed: number }[];
  errors: string[];
};

type FixtureRow = {
  id: string;
  sport: string;
  status: string | null;
  lifecycle_state: string | null;
  kickoff_at: string;
  started_at: string | null;
  resulted_at: string | null;
  home_score: number | null;
  away_score: number | null;
};

/**
 * Note what this does *not* touch: `op_fixtures.status`.
 *
 * Status stays the provider's last word. We write `lifecycle_state`, which is
 * our reading of the evidence, and the two sit side by side — a fixture the
 * provider still calls 'scheduled' that we call 'unresolved' is precisely the
 * row an operator needs to see. Folding our inference into `status` would
 * destroy the statement the inference was drawn from.
 */

export async function reconcileFixtureLifecycles({
  commit = false,
  now = new Date(),
  lookbackHours = 96,
  runId,
  client = getSupabaseServerClient()
}: {
  commit?: boolean;
  now?: Date;
  lookbackHours?: number;
  runId?: string;
  client?: SupabaseClient | null;
} = {}): Promise<ReconciliationReport> {
  const generatedAt = now.toISOString();
  const base = { committed: commit, generatedAt, scanned: 0, changes: [], bySport: [], errors: [] };
  if (!client) {
    return { ...base, status: "unavailable", errors: ["OddsPadi Supabase server storage is not configured."] };
  }

  // Two populations need reconciling, and one bound cannot serve both.
  //
  // **Forward path.** Fixtures past kick-off that we have not judged yet: still
  // `scheduled` or `live` according to the provider, and recent enough that a
  // provider might yet resolve them. Older rows are history and re-deciding
  // them serves nobody, so `lookbackHours` bounds the scan.
  //
  // **Release path.** Fixtures already in quarantine. `unresolved` is
  // documented as "not terminal — still able to be resolved by a later provider
  // read", but until now nothing could perform that release: the scan filtered
  // on `status in (scheduled, live)`, so the moment a recovery wrote
  // `status = 'finished'` the row became invisible to the only job that can
  // clear `lifecycle_state`. Measured in production on 2026-08-07, twelve
  // football fixtures held a final score, a `resulted_at`, and
  // `lifecycle_state = 'unresolved'` simultaneously — the strongest evidence
  // there is, sat behind a filter that could not see it. Publications on those
  // fixtures stay unsettled for ever, because settlement skips quarantined
  // lifecycle states by design.
  //
  // The release path therefore ignores `status` (that is the column that has
  // just changed) and ignores `lookbackHours` (quarantine is an open backlog,
  // not a window — the oldest of these is 27 days old and still owed an
  // answer). It is bounded instead by quarantine membership, which is small and
  // shrinks as rows are resolved.
  const since = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();
  const nowIso = now.toISOString();
  const columns = "id,sport,status,lifecycle_state,kickoff_at,started_at,resulted_at,home_score,away_score";

  /**
   * Read every matching row, not the first page of them.
   *
   * PostgREST caps a response at `db-max-rows` — 1000 on this project —
   * **regardless of the `.limit()` asked for**, and says nothing about having
   * truncated. A single `.limit(5_000)` over a 1,888-row quarantine backlog
   * returned 1000 rows and looked like the whole set; 32 football fixtures
   * holding a final score stayed quarantined because they sat on page two.
   *
   * Keyset on `id` rather than `kickoff_at`: fixtures routinely share a
   * kick-off time, and a cursor over a non-unique column silently skips every
   * row that ties with the last one on the page.
   *
   * The loop ends on an **empty** page, not on a short one. "Short means last"
   * only holds while the requested page size matches the server's cap exactly;
   * the moment `db-max-rows` is lower than `PAGE`, every page is short and the
   * very first one looks like the end. That is the same silent truncation this
   * helper exists to remove, so it is not worth one saved round trip.
   */
  const PAGE = 1_000;
  async function readAll(
    apply: (query: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => typeof query
  ): Promise<{ rows: FixtureRow[]; error: string | null }> {
    const rows: FixtureRow[] = [];
    let cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { data, error } = await apply(
        client!.from("op_fixtures").select(columns) as never
      )
        .gt("id", cursor)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) return { rows, error: error.message };
      const page = (data ?? []) as FixtureRow[];
      if (!page.length) return { rows, error: null };
      rows.push(...page);
      cursor = page[page.length - 1].id;
    }
  }

  const [pending, quarantined] = await Promise.all([
    readAll((query) => query.lt("kickoff_at", nowIso).gte("kickoff_at", since).in("status", ["scheduled", "live"])),
    readAll((query) => query.lt("kickoff_at", nowIso).in("lifecycle_state", [...QUARANTINED_STATES]))
  ]);

  const error = pending.error ?? quarantined.error;
  if (error) return { ...base, status: "unavailable", errors: [error] };

  // The two populations overlap — a quarantined fixture the provider still
  // calls `scheduled` is in both — so de-duplicate before deciding, or it would
  // be counted twice and written twice.
  const byId = new Map<string, FixtureRow>();
  for (const row of [...pending.rows, ...quarantined.rows]) byId.set(row.id, row);
  const rows = [...byId.values()];
  const changes: ReconciliationChange[] = [];
  const tally = new Map<string, { scanned: number; changed: number }>();

  for (const row of rows) {
    const counts = tally.get(row.sport) ?? { scanned: 0, changed: 0 };
    counts.scanned += 1;
    tally.set(row.sport, counts);

    const lifecycle = fixtureLifecycle(
      {
        sport: row.sport,
        kickoffAt: new Date(row.kickoff_at),
        status: row.status,
        startedAt: row.started_at ? new Date(row.started_at) : null,
        resultedAt: row.resulted_at ? new Date(row.resulted_at) : null,
        homeScore: row.home_score,
        awayScore: row.away_score
      },
      now
    );

    // Compared against our own previous reading, not against the provider's
    // status — those legitimately differ, and treating every difference as a
    // change would rewrite the same rows on every run.
    if (lifecycle.state === row.lifecycle_state) continue;

    counts.changed += 1;
    changes.push({
      fixtureId: row.id,
      sport: row.sport,
      from: row.lifecycle_state ?? "unreconciled",
      to: lifecycle.state,
      basis: lifecycle.basis,
      overdueHours: Math.round((lifecycle.overdueByMs / 3_600_000) * 10) / 10
    });
  }

  const report: ReconciliationReport = {
    ...base,
    status: commit ? "completed" : "preview",
    scanned: rows.length,
    changes,
    bySport: [...tally].map(([sport, counts]) => ({ sport, ...counts }))
  };

  if (!commit || !changes.length) return report;

  const errors: string[] = [];
  for (let index = 0; index < changes.length; index += 200) {
    const batch = changes.slice(index, index + 200);

    // The audit row goes in first. If the status update then fails we are left
    // with a claim of a transition that did not happen, which is noisy but
    // detectable; the reverse — a silent status change with no record — is the
    // failure this table exists to prevent.
    const { error: auditError } = await client.from("op_fixture_lifecycle_transitions").insert(
      batch.map((change) => ({
        fixture_id: change.fixtureId,
        from_state: change.from,
        to_state: change.to,
        basis: change.basis,
        overdue_hours: change.overdueHours,
        run_id: runId ?? null
      }))
    );
    if (auditError) {
      errors.push(`Transition audit insert failed: ${auditError.message}`);
      continue;
    }

    // Grouped by target state so each update is one statement rather than one
    // per fixture; `in` keeps it a single round trip per state.
    for (const state of new Set(batch.map((change) => change.to))) {
      const ids = batch.filter((change) => change.to === state).map((change) => change.fixtureId);
      const { error: updateError } = await client
        .from("op_fixtures")
        .update({ lifecycle_state: state, lifecycle_state_at: now.toISOString() })
        .in("id", ids);
      if (updateError) errors.push(`Lifecycle update to ${state} failed: ${updateError.message}`);
    }
  }

  return { ...report, errors };
}
