import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OddsPadi accepts no file uploads: avatars are OAuth-provider URLs, there is
 * no storage bucket, and no form takes a file. This test keeps it that way —
 * a new upload path is a new attack surface (malicious files, storage abuse)
 * that must be a deliberate, reviewed decision, not something introduced by
 * accident.
 */
const ROOTS = ["src/app", "src/components", "src/lib"];
const UPLOAD_MARKERS = [/storage\.from\(/, /\.upload\(/, /createBucket/, /type="file"/, /multipart\/form-data/];

async function collect(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_archived" && entry.name !== "node_modules") await walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) out.push(path);
    }
  }
  await walk(join(process.cwd(), root));
  return out;
}

describe("no file-upload surface exists", () => {
  it("introduces no storage bucket, upload call, or file input", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of await collect(root)) {
        const source = await readFile(file, "utf8");
        if (UPLOAD_MARKERS.some((marker) => marker.test(source))) offenders.push(file);
      }
    }
    expect(offenders, "a file-upload surface was introduced — this needs a deliberate security review").toEqual([]);
  });
});
