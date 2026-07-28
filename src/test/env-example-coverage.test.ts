import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "netlify", "scripts"];
const IGNORED_DIRECTORIES = new Set(["_archived", "node_modules", "test"]);

/** Supplied by the platform or the toolchain, not by an operator. */
const PLATFORM_VARIABLES = new Set([
  "NODE_ENV",
  "NODE_VERSION",
  "URL",
  "CI",
  "PATH",
  "HOME",
  "NEXT_TELEMETRY_DISABLED",
  "npm_config_user_agent",
  // Set by run-netlify-deploy.cjs for the smoke-test child process, not by an
  // operator — an internal handoff rather than configuration.
  "ODDSPADI_SMOKE_URL"
]);

async function collectSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectSources(path);
      return /\.(ts|tsx|mjs|cjs)$/.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

describe(".env.example", () => {
  /**
   * An operator setting up a new environment works from this file. A variable
   * the code requires but the template omits produces a runtime failure with no
   * hint that anything was missing — `ODDSPADI_SITE_URL` was referenced in 22
   * places across the scheduled functions and ops scripts, and every sweep
   * refuses to run without it, yet it appeared nowhere in the template.
   */
  it("documents every environment variable the code reads", async () => {
    const files = (await Promise.all(ROOTS.map(collectSources))).flat();
    expect(files.length).toBeGreaterThan(50);

    const referenced = new Set<string>();
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) referenced.add(match[1]);
      for (const match of source.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g)) referenced.add(match[1]);
      for (const match of source.matchAll(/env\.get\(["']([A-Z][A-Z0-9_]+)["']\)/g)) referenced.add(match[1]);
    }

    const template = await readFile(".env.example", "utf8");
    const documented = new Set(
      [...template.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1])
    );

    const undocumented = [...referenced].filter((name) => !documented.has(name) && !PLATFORM_VARIABLES.has(name)).sort();
    expect(undocumented).toEqual([]);
  });
});
