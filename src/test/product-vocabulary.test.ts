import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECISION_STATUS_LABELS, DECISION_STATUS_DESCRIPTIONS, SETTLEMENT_LABELS } from "@/lib/product/vocabulary";

/**
 * One vocabulary across the product.
 *
 * Before v1.7 the same decision state wore different words on different
 * surfaces — "Watchlist", "No Pick", "Needs data", "Suspended", "Price stale"
 * — three separate label maps plus inline literals. These tests pin the single
 * source and ban the synonyms from ever re-entering user-facing code, because
 * every one of them re-appeared at least twice historically.
 */
const BANNED_LABEL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: />Watchlist</, reason: 'state label must be "Watch"' },
  { pattern: /"Watchlist"/, reason: 'state label must be "Watch"' },
  { pattern: /`Watchlist`|badge[^>]*>Watchlist/, reason: 'state label must be "Watch"' },
  { pattern: />No Pick<|"No Pick"/, reason: 'state label must be "Pass"' },
  { pattern: />Needs data<|"Needs data/, reason: 'state label must be "Withheld"' },
  { pattern: />Not generated<|"Not generated"/, reason: 'state label must be "Withheld"' },
  { pattern: /metric-label">Provider gaps</, reason: 'state label must be "Withheld / Unavailable"' },
  { pattern: /"No prediction"/, reason: 'state label must be "Pass"' },
  { pattern: /statusLabel[^=]*=\s*\{?\s*"(?!\w)/, reason: "status labels come from vocabulary.ts" }
];

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    // The archived ops console is intentionally out of the product surface.
    if (entry.isDirectory()) {
      if (entry.name === "_archived") continue;
      files.push(...(await collectFiles(path)));
    } else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("product vocabulary", () => {
  it("covers every public status with a label and a description", () => {
    const statuses = Object.keys(DECISION_STATUS_LABELS);
    expect(statuses.length).toBeGreaterThanOrEqual(11);
    for (const status of statuses) {
      expect(DECISION_STATUS_LABELS[status as keyof typeof DECISION_STATUS_LABELS]).toBeTruthy();
      expect(DECISION_STATUS_DESCRIPTIONS[status as keyof typeof DECISION_STATUS_DESCRIPTIONS]).toBeTruthy();
    }
    expect(Object.keys(SETTLEMENT_LABELS)).toEqual(["won", "lost", "push", "void", "pending", "needs_review"]);
  });

  it("bans pre-consolidation status synonyms from user-facing code", async () => {
    const files = [
      ...(await collectFiles(join(process.cwd(), "src", "components"))),
      ...(await collectFiles(join(process.cwd(), "src", "app")))
    ];
    expect(files.length).toBeGreaterThan(50);
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const { pattern, reason } of BANNED_LABEL_PATTERNS) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern} (${reason})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the shared label map as the only status-label source in presentation code", async () => {
    const presentation = await readFile(join(process.cwd(), "src", "lib", "sports", "prediction", "presentation.ts"), "utf8");
    expect(presentation).toContain('from "@/lib/product/vocabulary"');
    expect(presentation).not.toMatch(/value_pick:\s*"/);
    const slate = await readFile(join(process.cwd(), "src", "components", "odds", "IntelligenceSlate.tsx"), "utf8");
    expect(slate).toContain('from "@/lib/product/vocabulary"');
    expect(slate).not.toMatch(/value_pick:\s*"/);
  });
});
