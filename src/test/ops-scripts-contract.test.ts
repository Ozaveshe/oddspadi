import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = "scripts";

/** Scripts whose job is to report a pass/fail outcome to a caller or a CI step. */
const REPORTING_SCRIPTS = [
  "site-health.mjs",
  "warm-caches.mjs",
  "run-editorial-sweep.mjs",
  "seed-community-posts.mjs",
  "backfill-public-results.mjs"
];

describe("ops scripts", () => {
  /**
   * An ops script that always exits 0 is worse than no script: the deploy step
   * or cron job that runs it reports success while the work it was supposed to
   * do failed silently. `warm-caches` and `seed-community-posts` both did this.
   */
  it("signal failure through the exit code", async () => {
    const offenders: string[] = [];
    for (const name of REPORTING_SCRIPTS) {
      const source = await readFile(join(SCRIPTS_DIR, name), "utf8");
      if (!/process\.exit\(\s*(?:failures|failed|1)/.test(source) && !/process\.exitCode\s*=/.test(source)) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("bound every network call with a timeout", async () => {
    const entries = await readdir(SCRIPTS_DIR);
    const offenders: string[] = [];

    for (const name of entries) {
      if (!name.endsWith(".mjs") && !name.endsWith(".cjs")) continue;
      const source = await readFile(join(SCRIPTS_DIR, name), "utf8");
      if (!/\bfetch\(/.test(source)) continue;
      // A script that hangs on an unreachable host pins a scheduled run. Either
      // idiom counts: `AbortSignal.timeout` or a manual controller + setTimeout.
      const bounded = source.includes("AbortSignal.timeout(") ||
        (source.includes("new AbortController()") && /setTimeout\(\s*\(\)\s*=>\s*\w+\.abort\(\)/.test(source));
      if (!bounded) offenders.push(name);
    }

    expect(offenders).toEqual([]);
  });

  it("never leave a top-level fetch unguarded", async () => {
    // A bare top-level `await fetch` turns an unreachable host into an
    // unhandled rejection and a raw stack trace, which reads like a bug in the
    // script rather than an outage.
    const entries = await readdir(SCRIPTS_DIR);
    const offenders: string[] = [];

    for (const name of entries) {
      if (!name.endsWith(".mjs")) continue;
      const source = await readFile(join(SCRIPTS_DIR, name), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // Top-level means column zero: anything inside a try block or a
        // function body is indented and is already someone's responsibility.
        if (/^(?:(?:const|let|var) )?\w*\s*=?\s*await fetch\(/.test(line)) offenders.push(`${name}:${index + 1}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
