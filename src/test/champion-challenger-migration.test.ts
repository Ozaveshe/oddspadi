import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260718043559_champion_challenger_governance.sql";

describe("champion challenger migration", () => {
  it("keeps receipts immutable and private to the service role", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists public.op_model_comparison_receipts");
    expect(sql).toContain("before update or delete on public.op_model_comparison_receipts");
    expect(sql).toContain("alter table public.op_model_comparison_receipts enable row level security");
    expect(sql).toContain("revoke all on public.op_model_comparison_receipts from anon, authenticated");
    expect(sql).toContain("grant select, insert on public.op_model_comparison_receipts to service_role");
  });

  it("enforces one active sport champion and atomic receipt-bound replacement", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create unique index op_calibration_promotions_one_active_sport_idx");
    expect(sql).toContain("create or replace function public.op_promote_calibration_challenger");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("resolve ambiguous legacy champions first");
    expect(sql).toContain("replacing an active champion requires a comparison receipt");
    expect(sql).toContain("comparison.latest_paired_outcome_at < now() - interval '7 days'");
    expect(sql).toContain("comparison.generated_at < now() - interval '7 days'");
    expect(sql).toContain("comparison.generated_at > now()");
    expect(sql).toContain("superseded by paired champion-challenger promotion");
    expect(sql).toContain("grant execute on function public.op_promote_calibration_challenger");
  });

  it("allows only strictly newer exact-identity calibration refreshes without mislabeling them as challengers", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("exact-identity calibration refreshes cannot claim a challenger comparison receipt");
    expect(sql).toContain("candidate.window_end <= incumbent_candidate.window_end");
    expect(sql).toContain("superseded by a strictly later exact-identity calibration refresh");
  });
});
