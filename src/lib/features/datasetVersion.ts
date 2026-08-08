import { createHash } from "node:crypto";

/**
 * Dataset versioning.
 *
 * "Reproducible" means: given this identifier, you can rebuild the exact rows a
 * model was trained on and get the same numbers. Nothing less counts, because a
 * model whose training set cannot be rebuilt cannot be audited, and a claim
 * that cannot be audited is a claim on trust alone.
 *
 * Five things have to be pinned, and leaving any one of them out is enough to
 * make the rest useless:
 *
 *   raw receipts     what the providers actually sent
 *   normalisation    how it was turned into rows
 *   labels           what counted as a win
 *   features         what was computed from the rows
 *   windows          which rows were train, validation and holdout
 *
 * Labels are the one people forget. Change the settlement basis — regulation
 * versus post-shootout, say — and every metric moves without a single feature
 * or row changing.
 */

export type DatasetComponents = {
  /** Content hash of the provider payload set. */
  rawReceiptSetId: string;
  /** Version of the normalisation that produced rows from receipts. */
  normalisationVersion: string;
  /** Which settlement rules defined the label. */
  labelDefinitionVersion: string;
  /** Feature set version, matching what the feature store stamped. */
  featureSetVersion: string;
  /** Chronological, and stated rather than derived at train time. */
  windows: {
    trainFrom: string;
    trainTo: string;
    validationFrom: string;
    validationTo: string;
    holdoutFrom: string;
    holdoutTo: string;
  };
};

export type DatasetVersion = DatasetComponents & {
  /** Deterministic id. Same components, same id, always. */
  id: string;
};

export function datasetVersion(components: DatasetComponents): DatasetVersion {
  // Key order is fixed rather than object insertion order, so two callers
  // building the same dataset differently still get the same id.
  const material = JSON.stringify([
    components.rawReceiptSetId,
    components.normalisationVersion,
    components.labelDefinitionVersion,
    components.featureSetVersion,
    components.windows.trainFrom,
    components.windows.trainTo,
    components.windows.validationFrom,
    components.windows.validationTo,
    components.windows.holdoutFrom,
    components.windows.holdoutTo
  ]);
  return { ...components, id: `ds_${createHash("sha256").update(material).digest("hex").slice(0, 16)}` };
}

export type WindowDefect = {
  kind: "overlap" | "out_of_order" | "empty" | "holdout_not_last";
  detail: string;
};

/**
 * Whether the split is chronologically honest.
 *
 * Random splits are the standard way to get a good number from a time series
 * and learn nothing: tomorrow's match teaches the model about yesterday's, and
 * the score is a measure of memorisation. So the windows must not overlap, must
 * run in order, and the holdout must be last — it is the only part that
 * simulates deployment.
 */
export function validateWindows(windows: DatasetComponents["windows"]): WindowDefect[] {
  const defects: WindowDefect[] = [];
  const spans: Array<[string, string, string]> = [
    ["train", windows.trainFrom, windows.trainTo],
    ["validation", windows.validationFrom, windows.validationTo],
    ["holdout", windows.holdoutFrom, windows.holdoutTo]
  ];

  for (const [name, from, to] of spans) {
    if (!(from < to)) {
      defects.push({ kind: "empty", detail: `${name} window is empty or inverted (${from} → ${to})` });
    }
  }

  const ordered: Array<[string, string, string]> = [spans[0]!, spans[1]!, spans[2]!];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const [earlierName, , earlierTo] = ordered[index]!;
    const [laterName, laterFrom] = ordered[index + 1]!;
    if (laterFrom < earlierTo) {
      defects.push({
        kind: "overlap",
        detail: `${laterName} starts at ${laterFrom}, before ${earlierName} ends at ${earlierTo}; the model would be scored on rows it trained on`
      });
    }
  }

  if (windows.holdoutFrom < windows.validationTo || windows.holdoutFrom < windows.trainTo) {
    defects.push({
      kind: "holdout_not_last",
      detail: "the holdout does not sit after both other windows, so it does not simulate deployment"
    });
  }

  if (windows.validationFrom < windows.trainFrom || windows.holdoutFrom < windows.validationFrom) {
    defects.push({ kind: "out_of_order", detail: "windows do not run train → validation → holdout in time order" });
  }

  return defects;
}

export type ReproductionCheck = {
  reproducible: boolean;
  mismatches: string[];
};

/**
 * Whether a rebuild matches the dataset it claims to be.
 *
 * Compares component by component rather than only the id, because "the ids
 * differ" tells an operator nothing about which of the five moved — and in
 * practice it is nearly always the labels.
 */
export function checkReproduction(expected: DatasetVersion, rebuilt: DatasetVersion): ReproductionCheck {
  const mismatches: string[] = [];
  const fields: Array<[string, string, string]> = [
    ["raw receipt set", expected.rawReceiptSetId, rebuilt.rawReceiptSetId],
    ["normalisation", expected.normalisationVersion, rebuilt.normalisationVersion],
    ["label definition", expected.labelDefinitionVersion, rebuilt.labelDefinitionVersion],
    ["feature set", expected.featureSetVersion, rebuilt.featureSetVersion]
  ];
  for (const [label, want, got] of fields) {
    if (want !== got) mismatches.push(`${label}: expected ${want}, rebuilt ${got}`);
  }
  if (JSON.stringify(expected.windows) !== JSON.stringify(rebuilt.windows)) {
    mismatches.push("train/validation/holdout windows differ");
  }
  return { reproducible: mismatches.length === 0 && expected.id === rebuilt.id, mismatches };
}
