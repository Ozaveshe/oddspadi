import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTIONS_DIR = "netlify/functions";

async function sweepFiles(): Promise<string[]> {
  const entries = await readdir(FUNCTIONS_DIR);
  return entries
    .filter((name) => name.endsWith(".ts") && !name.includes("-worker-background"))
    .map((name) => join(FUNCTIONS_DIR, name));
}

describe("scheduled sweep functions", () => {
  it("rebuild the worker reply instead of passing the upstream Response through", async () => {
    // Returning the fetch Response directly forwards every upstream header
    // verbatim into the scheduled-function reply. Half the sweeps already read
    // the body and rebuilt a bounded response; the rest did not.
    const offenders: string[] = [];
    for (const file of await sweepFiles()) {
      const source = await readFile(file, "utf8");
      if (!source.includes("fetch(")) continue;
      if (/return await fetch\(/.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("bound every worker call with a timeout so a hung worker cannot pin the schedule", async () => {
    const offenders: string[] = [];
    for (const file of await sweepFiles()) {
      const source = await readFile(file, "utf8");
      if (!source.includes("fetch(")) continue;
      if (!source.includes("AbortSignal.timeout(")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("require both the site URL and the admin token before invoking a worker", async () => {
    const offenders: string[] = [];
    for (const file of await sweepFiles()) {
      const source = await readFile(file, "utf8");
      if (!source.includes("fetch(")) continue;
      const guardsConfig = source.includes("ODDSPADI_ADMIN_TOKEN") && /if \(!\w*[Uu]rl.*\|\| !\w*[Tt]oken\)/.test(source);
      if (!guardsConfig) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
