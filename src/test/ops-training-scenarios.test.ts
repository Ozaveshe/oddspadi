import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRAINING_SCENARIOS,
  evaluateTrainingChoice,
  trainingScenario,
  type TrainingTask
} from "@/lib/ops/trainingScenarios";

const read = (rel: string) => readFileSync(join(process.cwd(), ...rel.split("/")), "utf8");

describe("training scenarios", () => {
  it("covers the five training tasks the brief names", () => {
    const tasks = new Set<TrainingTask>(TRAINING_SCENARIOS.map((s) => s.task));
    for (const required of [
      "resolve_stale_fixture",
      "map_market",
      "settle_edge_case",
      "approve_content",
      "moderate_report"
    ] as const) {
      expect(tasks, `missing task ${required}`).toContain(required);
    }
  });

  it("gives every scenario exactly one correct option with feedback", () => {
    for (const s of TRAINING_SCENARIOS) {
      const correct = s.options.filter((o) => o.correct);
      expect(correct.length, `${s.id} must have exactly one correct option`).toBe(1);
      for (const o of s.options) {
        expect(o.feedback.length, `${s.id}/${o.id} needs feedback`).toBeGreaterThan(0);
      }
    }
  });

  it("uses only synthetic ids — never a real fixture or publication id", () => {
    for (const s of TRAINING_SCENARIOS) {
      expect(s.id.startsWith("SYNTHETIC-"), `${s.id} must be synthetic`).toBe(true);
      // The brief text references synthetic entities, not bare uuids.
      expect(s.brief).toMatch(/SYNTHETIC|synthetic/);
    }
  });

  it("evaluates a choice purely, returning feedback or null for an unknown option", () => {
    const scenario = TRAINING_SCENARIOS[2]; // settle edge case
    const correctOption = scenario.options.find((o) => o.correct)!;
    const wrongOption = scenario.options.find((o) => !o.correct)!;
    expect(evaluateTrainingChoice(scenario.id, correctOption.id)?.correct).toBe(true);
    expect(evaluateTrainingChoice(scenario.id, wrongOption.id)?.correct).toBe(false);
    expect(evaluateTrainingChoice(scenario.id, "no-such-option")).toBeNull();
    expect(evaluateTrainingChoice("no-such-scenario", correctOption.id)).toBeNull();
    expect(trainingScenario(scenario.id)?.task).toBe("settle_edge_case");
  });
});

describe("the sandbox cannot touch production", () => {
  it("makes no network call and no write from the training surface", () => {
    const sandbox = read("src/components/ops/TrainingSandbox.tsx");
    // The sandbox grades choices purely, in the browser — no fetch, no API.
    expect(sandbox).not.toMatch(/\bfetch\s*\(/);
    expect(sandbox).not.toContain("/api/");

    const page = read("src/app/ops/training/page.tsx");
    // The page reads no data source — it renders synthetic scenarios only.
    expect(page).not.toContain("getSupabaseServerClient");
    expect(page).toContain('noIndex: true');
  });
});
