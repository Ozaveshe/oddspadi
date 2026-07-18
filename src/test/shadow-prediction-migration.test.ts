import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260718041857_shadow_prediction_plane.sql";

describe("private shadow prediction migration", () => {
  it("keeps challenger evidence server-only and append-only", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists public.op_shadow_predictions");
    expect(sql).toContain("unique (champion_outcome_id, model_artifact_hash)");
    expect(sql).toContain("check (generated_at < kickoff_at)");
    expect(sql).toContain("before update on public.op_shadow_predictions");
    expect(sql).toContain("before delete on public.op_shadow_predictions");
    expect(sql).toContain("alter table public.op_shadow_predictions enable row level security");
    expect(sql).toContain("revoke all on public.op_shadow_predictions from public, service_role, anon, authenticated");
    expect(sql).toContain("grant select, insert, update on public.op_shadow_predictions to service_role");
    expect(sql).toContain("implied_probability is null or implied_probability between 0 and 1");
    expect(sql).toContain("odds is null or odds > 1");
    expect(sql).toContain("closing_odds is null or closing_odds > 1");
    expect(sql).toContain("settled_at is null or settled_at >= kickoff_at");
  });

  it("allows only atomic settlement while freezing identity and probability", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("new.model_artifact_hash is distinct from old.model_artifact_hash");
    expect(sql).toContain("new.model_probability is distinct from old.model_probability");
    expect(sql).toContain("new.result = 'pending' or new.settled_at is null");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
  });
});
