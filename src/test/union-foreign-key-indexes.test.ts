import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260718070108_index_union_foreign_keys.sql";

describe("union release foreign-key indexes", () => {
  it("covers every foreign key reported by the post-migration advisor", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    for (const index of [
      "op_community_tips_fixture_db_idx",
      "op_community_tip_revisions_author_idx",
      "op_community_consensus_fixture_db_idx",
      "op_community_consensus_decision_summary_idx",
      "op_shadow_predictions_model_version_idx",
      "op_shadow_predictions_champion_decision_run_idx",
    ]) {
      expect(sql).toContain(`create index if not exists ${index}`);
    }
  });
});
