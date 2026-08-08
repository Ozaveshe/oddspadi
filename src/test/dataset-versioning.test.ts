import { describe, expect, it } from "vitest";
import {
  checkReproduction,
  datasetVersion,
  validateWindows,
  type DatasetComponents
} from "@/lib/features/datasetVersion";

function components(overrides: Partial<DatasetComponents> = {}): DatasetComponents {
  return {
    rawReceiptSetId: "receipts_abc123",
    normalisationVersion: "norm.v4",
    labelDefinitionVersion: "2026-08-07.1",
    featureSetVersion: "features.v9",
    windows: {
      trainFrom: "2025-08-01T00:00:00.000Z",
      trainTo: "2026-04-01T00:00:00.000Z",
      validationFrom: "2026-04-01T00:00:00.000Z",
      validationTo: "2026-06-01T00:00:00.000Z",
      holdoutFrom: "2026-06-01T00:00:00.000Z",
      holdoutTo: "2026-08-01T00:00:00.000Z"
    },
    ...overrides
  };
}

describe("dataset identity", () => {
  it("is deterministic for the same components", () => {
    expect(datasetVersion(components()).id).toBe(datasetVersion(components()).id);
  });

  it("changes when the label definition changes", () => {
    // The one people forget: change the settlement basis and every metric
    // moves without a single feature or row changing.
    const before = datasetVersion(components()).id;
    const after = datasetVersion(components({ labelDefinitionVersion: "2026-08-07.2" })).id;
    expect(after).not.toBe(before);
  });

  it("changes when any of the five components changes", () => {
    const base = datasetVersion(components()).id;
    const variants = [
      components({ rawReceiptSetId: "receipts_other" }),
      components({ normalisationVersion: "norm.v5" }),
      components({ featureSetVersion: "features.v10" }),
      components({ windows: { ...components().windows, trainFrom: "2025-09-01T00:00:00.000Z" } })
    ];
    for (const variant of variants) {
      expect(datasetVersion(variant).id).not.toBe(base);
    }
  });

  it("does not depend on the order the caller built the object in", () => {
    const forwards = datasetVersion(components());
    const backwards = datasetVersion({
      windows: components().windows,
      featureSetVersion: components().featureSetVersion,
      labelDefinitionVersion: components().labelDefinitionVersion,
      normalisationVersion: components().normalisationVersion,
      rawReceiptSetId: components().rawReceiptSetId
    });
    expect(backwards.id).toBe(forwards.id);
  });
});

describe("chronological honesty", () => {
  it("accepts windows that run in order without overlapping", () => {
    expect(validateWindows(components().windows)).toEqual([]);
  });

  it("catches a validation window that starts before training ends", () => {
    // The model would be scored on rows it trained on.
    const defects = validateWindows({
      ...components().windows,
      validationFrom: "2026-03-01T00:00:00.000Z"
    });
    expect(defects.map((d) => d.kind)).toContain("overlap");
    expect(defects[0]?.detail).toContain("trained on");
  });

  it("catches a holdout that is not last", () => {
    // The holdout is the only part that simulates deployment.
    const defects = validateWindows({
      ...components().windows,
      holdoutFrom: "2026-01-01T00:00:00.000Z",
      holdoutTo: "2026-03-01T00:00:00.000Z"
    });
    expect(defects.map((d) => d.kind)).toContain("holdout_not_last");
  });

  it("catches an empty or inverted window", () => {
    const defects = validateWindows({
      ...components().windows,
      trainTo: "2025-01-01T00:00:00.000Z"
    });
    expect(defects.map((d) => d.kind)).toContain("empty");
  });

  it("catches windows out of chronological order entirely", () => {
    const defects = validateWindows({
      trainFrom: "2026-06-01T00:00:00.000Z",
      trainTo: "2026-08-01T00:00:00.000Z",
      validationFrom: "2026-01-01T00:00:00.000Z",
      validationTo: "2026-03-01T00:00:00.000Z",
      holdoutFrom: "2026-03-01T00:00:00.000Z",
      holdoutTo: "2026-05-01T00:00:00.000Z"
    });
    expect(defects.map((d) => d.kind)).toContain("out_of_order");
  });
});

describe("reproduction", () => {
  it("passes when a rebuild matches", () => {
    const check = checkReproduction(datasetVersion(components()), datasetVersion(components()));
    expect(check.reproducible).toBe(true);
    expect(check.mismatches).toEqual([]);
  });

  it("names which component moved rather than only that the ids differ", () => {
    // "The ids differ" tells an operator nothing, and in practice it is nearly
    // always the labels.
    const check = checkReproduction(
      datasetVersion(components()),
      datasetVersion(components({ labelDefinitionVersion: "2026-08-07.2" }))
    );
    expect(check.reproducible).toBe(false);
    expect(check.mismatches[0]).toContain("label definition");
  });

  it("names a window difference", () => {
    const check = checkReproduction(
      datasetVersion(components()),
      datasetVersion(components({ windows: { ...components().windows, holdoutTo: "2026-09-01T00:00:00.000Z" } }))
    );
    expect(check.mismatches.join(" ")).toContain("windows differ");
  });

  it("reports every mismatch, not just the first", () => {
    const check = checkReproduction(
      datasetVersion(components()),
      datasetVersion(components({ normalisationVersion: "norm.v5", featureSetVersion: "features.v10" }))
    );
    expect(check.mismatches).toHaveLength(2);
  });
});
