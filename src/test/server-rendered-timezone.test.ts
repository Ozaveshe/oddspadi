import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src/app", "src/components"];
const IGNORED_DIRECTORIES = new Set(["_archived", "node_modules"]);

/**
 * `toLocale*` with no explicit `timeZone` resolves against whatever zone the
 * render host runs in — UTC on Netlify. For a fixture-times product aimed at a
 * West-Africa audience that silently shows every kickoff an hour off, and in a
 * client component it also desyncs hydration. `LocalTime`/`LocalTimeText` own
 * the deterministic-then-local handoff; anything else must pin `timeZone`.
 */
const UNPINNED_LOCALE_CALL = /\.toLocale(?:Time|Date)?String\(/;

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectFiles(path);
      return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") ? [path] : [];
    })
  );
  return files.flat();
}

/** Strips the argument list of every `Intl.DateTimeFormat(...)` construction. */
function withoutPinnedFormatters(source: string): string {
  return source.replace(/new Intl\.DateTimeFormat\([\s\S]*?\)\;/g, "");
}

describe("rendered timestamps", () => {
  it("never formats a date against the render host's timezone", async () => {
    const files = (await Promise.all(ROOTS.map(collectFiles))).flat();
    expect(files.length).toBeGreaterThan(30);

    const offenders: string[] = [];
    for (const file of files) {
      // LocalTime is the one component allowed to call toLocale* directly: it
      // pins UTC for the deterministic pass and only drops the pin after mount.
      if (file.endsWith("LocalTime.tsx")) continue;
      const source = await readFile(file, "utf8");
      for (const [index, line] of withoutPinnedFormatters(source).split("\n").entries()) {
        // Number formatting (`count.toLocaleString()`) is locale-only and safe.
        if (!UNPINNED_LOCALE_CALL.test(line)) continue;
        if (/\btimeZone\s*:/.test(line)) continue;
        if (/\bDate\b|dateStyle|timeStyle|weekday|kickoff|\bhour\b/.test(line)) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
