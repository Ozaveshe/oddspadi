import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260716210929_harden_trigger_function_search_paths.sql";
const functions = [
  "op_block_calibration_candidate_mutation",
  "op_prevent_settled_outcome_rewrite",
  "op_validate_calibration_promotion"
];

describe("Supabase trigger function hardening", () => {
  it("pins each trigger helper search path and removes public API execution", async () => {
    const source = await readFile(migration, "utf8");

    for (const name of functions) {
      expect(source).toContain(`alter function public.${name}()`);
      expect(source).toMatch(new RegExp(`alter function public\\.${name}\\(\\)\\s+set search_path = pg_catalog, public;`));
      expect(source).toMatch(new RegExp(`revoke execute on function public\\.${name}\\(\\)\\s+from public, anon, authenticated;`));
    }
  });
});
