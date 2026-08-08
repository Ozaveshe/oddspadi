import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { transition, type ModelRecord } from "@/lib/model/registry";

const migration = "supabase/migrations/20260808120000_model_registry.sql";

describe("model registry migration", () => {
  it("enforces the lifecycle paths in the database, not just in TypeScript", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists public.op_model_registry");
    expect(sql).toContain("state in ('candidate', 'shadow', 'approved', 'degraded', 'retired', 'rolled_back')");
    // Entry is candidate only; the trigger refuses models born approved.
    expect(sql).toContain("models are born candidates");
    // Path enforcement mirrors registry.ts, including retired as terminal.
    expect(sql).toContain("when 'candidate'   then new.state in ('shadow')");
    expect(sql).toContain("when 'shadow'      then new.state in ('approved', 'retired')");
    expect(sql).toContain("when 'degraded'    then new.state in ('approved', 'rolled_back')");
    expect(sql).toContain("else false -- retired is terminal");
    // Evidence demands.
    expect(sql).toContain("approval requires evaluation evidence");
    expect(sql).toContain("was never approved; rolling back onto it would promote it by accident");
    // History is append-only and tied to the transition it records.
    expect(sql).toContain("a state change must append exactly one history step");
    expect(sql).toContain("history is append-only");
    expect(sql).toContain("history changes only alongside the state change");
  });

  it("keeps the registry server-only, immutable in identity, and undeletable", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("model identity and provenance are immutable");
    expect(sql).toContain("registry rows are never deleted");
    expect(sql).toContain("alter table public.op_model_registry enable row level security");
    expect(sql).toContain("revoke all on public.op_model_registry from public, service_role, anon, authenticated");
    expect(sql).toContain("grant select, insert, update on public.op_model_registry to service_role");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
  });

  it("registers both lab candidates in shadow with their honest evidence", async () => {
    const sql = (await readFile(migration, "utf8"));

    expect(sql).toContain("'football-1x2-dixon-coles-v1'");
    expect(sql).toContain("'tennis-mw-surface-elo-v1'");
    // The evidence recorded is the losing result, not a sales pitch.
    expect(sql).toContain("does not beat the closing market");
    expect(sql).toContain("does not beat the bookmaker consensus");
    // Both land in shadow via a real transition, not a hand-set state.
    expect(sql.match(/state = 'shadow'/g)).toHaveLength(2);
    expect(sql.match(/'from', 'candidate',\s*'to', 'shadow'/g)).toHaveLength(2);
    // Idempotent seed.
    expect(sql).toContain("on conflict (model_id) do nothing");
    expect(sql).toContain("and state = 'candidate'");
  });

  it("agrees with the TypeScript state machine about the seeded path", () => {
    // The migration walks candidate → shadow; the pure function must accept
    // the identical walk, or the two enforcement layers have diverged.
    const record: ModelRecord = {
      modelId: "football-1x2-dixon-coles-v1",
      state: "candidate",
      datasetVersionId: "standard-v1",
      featureSetVersion: "dc-strengths-home-decay-v1",
      hyperparameters: { decayPerDay: 0.0065 },
      calibrationMethod: "identity",
      decisionPolicyVersion: "decision-policy-v1",
      evaluation: { verdict: "does not beat the closing market; challenger only" },
      approvedAt: null,
      approvedBy: null,
      rollbackTargetId: null,
      history: []
    };
    const toShadow = transition(record, {
      to: "shadow",
      at: "2026-08-08T12:00:00Z",
      reason: "Behind the de-vigged close on the 2026 holdout; shadow observes, publishes nothing."
    });
    expect(toShadow.ok).toBe(true);
    // And the path the trigger refuses, the function refuses too.
    const straightToApproved = transition(record, {
      to: "approved",
      at: "2026-08-08T12:00:00Z",
      reason: "Looks good enough to skip shadow.",
      gatesPassed: true,
      approvedBy: "nobody"
    });
    expect(straightToApproved.ok).toBe(false);
  });
});
