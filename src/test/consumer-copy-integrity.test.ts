import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Certainty language, banned at the repository level.
 *
 * A sweep of every user-visible string found the product already clean — the
 * only matches were a prompt instructing the model *not* to promise wins and a
 * disclaimer saying readings are *not* guaranteed. That is a state worth
 * keeping, and an audit that is not enforced decays with the next copy edit.
 *
 * The ban is on claims, not on vocabulary. "Odds", "stake", "accumulator",
 * "value", "bet" all describe real markets and must stay: the product cannot
 * explain a market it is not allowed to name. What is banned is language that
 * promises an outcome.
 */
const BANNED_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bguaranteed\s+(win|profit|return|payout|outcome)/i, why: "promises an outcome" },
  { pattern: /\bsure\s+(bet|odds|thing|win|banker)/i, why: "promises an outcome" },
  { pattern: /\b(100|99)\s*%\s*(sure|certain|accurate|win)/i, why: "claims near-certainty" },
  { pattern: /\bcan(?:'|’)?t\s+lose\b|\bcannot\s+lose\b/i, why: "denies risk" },
  { pattern: /\brisk[- ]free\b/i, why: "denies risk" },
  { pattern: /\bfixed\s+match/i, why: "implies corruption" },
  { pattern: /\bwin(?:ning)?\s+every\s+(day|time|week)\b/i, why: "promises a run" },
  { pattern: /\beasy\s+money\b/i, why: "trivialises loss" },
  { pattern: /\bnever\s+lose[s]?\b/i, why: "denies risk" },
  { pattern: /\bjackpot\s+guarantee/i, why: "promises an outcome" }
];

/**
 * A negation directly before the phrase flips its meaning ("not guaranteed",
 * "never promise sure odds"). Those are the product saying the right thing.
 */
const NEGATED = /\b(not|never|no|isn(?:'|’)?t|aren(?:'|’)?t|without|don(?:'|’)?t|doesn(?:'|’)?t|rather than|instead of)\b[^.]{0,40}$/i;

const COPY_ROOTS = ["src/app", "src/components", "src/lib/editorial", "src/lib/sports/tips"];

async function copyFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_archived" && entry.name !== "node_modules") await walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) found.push(path);
    }
  }
  await walk(root);
  return found;
}

describe("consumer copy never promises an outcome", () => {
  it("bans certainty claims across every user-facing surface", async () => {
    const offenders: string[] = [];

    for (const root of COPY_ROOTS) {
      for (const path of await copyFiles(root)) {
        const source = await readFile(path, "utf8");
        const lines = source.split("\n");
        lines.forEach((line, index) => {
          for (const { pattern, why } of BANNED_CLAIMS) {
            const match = pattern.exec(line);
            if (!match) continue;
            // "not guaranteed to win" is the honest form of the same words.
            if (NEGATED.test(line.slice(0, match.index))) continue;
            offenders.push(`${path}:${index + 1} — ${why}: ${line.trim().slice(0, 100)}`);
          }
        });
      }
    }

    expect(offenders, "certainty language must not reach consumer copy").toEqual([]);
  });

  it("keeps legitimate market vocabulary available", async () => {
    // The inverse guard. A previous instinct on briefs like this is to sanitise
    // the product until it can no longer describe what it analyses. If these
    // words vanish, the ban above has been applied too widely.
    const source = await readFile("src/lib/product/vocabulary.ts", "utf8");
    const combined = source + (await readFile("src/app/responsible-use/page.tsx", "utf8"));
    for (const required of ["odds", "stake", "bet"]) {
      expect(combined.toLowerCase(), `"${required}" must remain usable`).toContain(required);
    }
  });
});

describe("responsible-use support is not single-country", () => {
  it("offers support beyond Great Britain", async () => {
    const source = await readFile("src/app/responsible-use/page.tsx", "utf8");
    // BeGambleAware serves Great Britain. It was the only resource on the site.
    expect(source).toContain("begambleaware.org");
    const others = ["gamblingtherapy.org", "responsiblegambling.org.za", "mentallyaware.org"];
    for (const href of others) {
      expect(source, `an African or international audience needs ${href}`).toContain(href);
    }
  });

  it("states the age limit, the risk and that probabilities are not guarantees", async () => {
    const source = (await readFile("src/app/responsible-use/page.tsx", "utf8")).toLowerCase();
    expect(source).toContain("18");
    expect(source).toContain("chas"); // loss-chasing guidance
    expect(source).toContain("probabilities are not");
    expect(source).toContain("risk of losing money");
  });

  it("is reachable from the footer of every page", async () => {
    const footer = await readFile("src/components/site/SiteFooter.tsx", "utf8");
    expect(footer).toContain("/responsible-use");
    // The old footer sent everyone to a single national helpline.
    expect(footer).not.toContain("begambleaware.org");
  });

  it("is reachable from the notice shown on every prediction surface", async () => {
    const notice = await readFile("src/components/odds/PredictionDisclaimer.tsx", "utf8");
    expect(notice).toContain("/responsible-use");
  });
});
