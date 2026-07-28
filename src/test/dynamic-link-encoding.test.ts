import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/app", "src/components"];

/**
 * Provider match ids (`api-football:12345`), editorial slugs and forum
 * category slugs are all external values interpolated into route paths. Most of
 * the codebase already encodes them — the sitemap, the match route, the live
 * board and the bet-slip button all call `encodeURIComponent` — but eleven
 * links did not. An id or slug containing `/`, `?`, `#` or a space silently
 * points the link somewhere else, and the inconsistency is what makes it easy
 * to reintroduce.
 */
describe("dynamic route links", () => {
  it("percent-encode every interpolated path segment", async () => {
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (!entry.name.endsWith(".tsx")) continue;
        const source = await readFile(path, "utf8");
        for (const [index, line] of source.split("\n").entries()) {
          // Only route-shaped template hrefs; query strings are a separate case.
          const matches = line.matchAll(/href=\{`\/[^`]*?\$\{([^}]+)\}/g);
          for (const match of matches) {
            const expression = match[1];
            if (expression.includes("encodeURIComponent")) continue;
            offenders.push(`${path}:${index + 1}: \${${expression}}`);
          }
        }
      }
    }

    await Promise.all(ROOTS.map(walk));
    expect(offenders).toEqual([]);
  });
});
