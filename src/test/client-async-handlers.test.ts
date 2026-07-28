import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = "src/components";

async function collectClientComponents(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectClientComponents(path);
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) return [];
      const source = await readFile(path, "utf8");
      return source.startsWith('"use client"') ? [path] : [];
    })
  );
  return files.flat();
}

describe("client components that fetch", () => {
  /**
   * A `fetch` that rejects — the network drops, the visitor goes offline, an
   * in-flight request is aborted — skips every statement after it. Where the
   * handler had set a `busy`/`saving` flag first, that flag was never cleared
   * and the control stayed disabled until a full page reload.
   */
  it("clear their busy flag through finally, not a trailing statement", async () => {
    const files = await collectClientComponents(COMPONENT_ROOT);
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      // Counted, not merely detected: a file-level "does a finally exist?"
      // check passes as soon as *one* handler is guarded, which is how a second
      // unguarded handler in an already-compliant file slipped through.
      const busyStarts = source.match(/\bset(?:Busy|Saving|Submitting|Pending)\(true\)/g)?.length ?? 0;
      if (busyStarts === 0) continue;
      if (!source.includes("await fetch(")) continue;
      const finallyBlocks = source.match(/finally\s*\{/g)?.length ?? 0;
      if (finallyBlocks < busyStarts) offenders.push(`${file}: ${busyStarts} busy flag(s), ${finallyBlocks} finally block(s)`);
    }

    expect(offenders).toEqual([]);
  });

  /**
   * `navigator.clipboard.writeText` and `navigator.share` both reject on a
   * denied permission, and a bare `await` on either surfaced an unhandled
   * rejection in the console for what is a purely cosmetic action.
   */
  it("guard clipboard and share calls", async () => {
    const files = await collectClientComponents(COMPONENT_ROOT);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!/navigator\.(clipboard|share)/.test(source)) continue;
      if (!/try\s*\{/.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  /**
   * A `setTimeout` whose handle is never stored cannot be cleared on unmount,
   * and a second click races a second timer against the first.
   */
  it("retain and clear every reset timer they schedule", async () => {
    const files = await collectClientComponents(COMPONENT_ROOT);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const schedules = source.match(/window\.setTimeout\(|(?<![.\w])setTimeout\(/g)?.length ?? 0;
      if (schedules === 0) continue;
      if (!/clearTimeout\(/.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
