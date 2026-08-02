#!/usr/bin/env node
/**
 * Generated docs must match what the code currently produces.
 *
 * docs/state-test-matrix.md is written from the coherence model. If someone
 * adds a state and does not regenerate, the checked-in matrix describes a
 * product that no longer exists — and a stale matrix is more dangerous than no
 * matrix, because it is read as current.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PATH = "docs/state-test-matrix.md";
const before = readFileSync(PATH, "utf8");

const run = spawnSync("npx", ["vite-node", "--config", "scripts/vite-node.config.ts", "scripts/generate-state-matrix-doc.ts"], {
  stdio: "pipe",
  shell: process.platform === "win32",
  encoding: "utf8"
});
if (run.status !== 0) {
  console.error("could not regenerate the state matrix doc:");
  console.error(run.stderr || run.stdout);
  process.exit(1);
}

const after = readFileSync(PATH, "utf8");
if (before !== after) {
  console.error(`${PATH} is out of date. Run: npm run docs:state-matrix`);
  console.error("The regenerated file has been written; commit it.");
  process.exit(1);
}
console.log(`${PATH} is current`);
