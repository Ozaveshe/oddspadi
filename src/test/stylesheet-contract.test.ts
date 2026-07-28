import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLESHEET = "src/app/globals.css";

/** Custom properties supplied per-element from a React `style` prop. */
const INLINE_PROPERTIES = new Set(["--decision-probability-width"]);

async function stylesheet(): Promise<string> {
  return readFile(STYLESHEET, "utf8");
}

describe("stylesheet custom properties", () => {
  /**
   * An undefined `var()` makes the whole declaration invalid *at computed-value
   * time*, which is not the same as being ignored: the property falls back to
   * its initial value, and it still wins the cascade over any earlier rule. So
   * `background: var(--undefined)` does not leave the previous background in
   * place — it renders transparent. Four tokens were referenced and never
   * declared, one of which made won-result dots invisible on the public record.
   */
  it("declares every custom property it references", async () => {
    const source = await stylesheet();
    const declared = new Set(source.match(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)?.map((line) => line.trim().replace(/\s*:$/, "")) ?? []);
    const referenced = new Set(source.match(/var\(\s*--[a-zA-Z0-9-]+/g)?.map((match) => match.replace(/var\(\s*/, "")) ?? []);

    const undeclared = [...referenced].filter((name) => !declared.has(name) && !INLINE_PROPERTIES.has(name));
    expect(undeclared).toEqual([]);
  });

  it("declares every custom property referenced from a component style prop", async () => {
    const source = await stylesheet();
    const declared = new Set(source.match(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)?.map((line) => line.trim().replace(/\s*:$/, "")) ?? []);
    const referenced = new Set<string>();

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (!entry.name.endsWith(".tsx")) continue;
        const file = await readFile(path, "utf8");
        for (const match of file.match(/var\(\s*--[a-zA-Z0-9-]+/g) ?? []) {
          referenced.add(match.replace(/var\(\s*/, ""));
        }
      }
    }

    await Promise.all(["src/app", "src/components"].map(walk));
    expect([...referenced].filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe("focus indicators", () => {
  /**
   * WCAG 2.4.11 requires a visible focus indicator. Removing the outline is
   * fine, but only when something replaces it — a 1px border-colour change is
   * colour-only and does not qualify.
   */
  it("pairs every outline removal with a replacement ring", async () => {
    // Comments are stripped first — they discuss `outline: none` by name, and a
    // guard that flags its own rationale is a guard nobody will keep.
    const source = (await stylesheet()).replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];

    for (const [index, line] of source.split("\n").entries()) {
      if (!/outline:\s*none/.test(line)) continue;
      // A same-line rule must carry its own ring; a multi-line rule is checked
      // against the declarations already seen in the same block.
      const block = source.slice(0, source.indexOf(line) + line.length);
      const currentRule = block.slice(block.lastIndexOf("{") + 1);
      const hasRing = /(?:box-shadow|outline):[^;]*\d+px/.test(currentRule);
      if (!hasRing) offenders.push(`${STYLESHEET}:${index + 1}: ${line.trim()}`);
    }

    expect(offenders).toEqual([]);
  });
});
