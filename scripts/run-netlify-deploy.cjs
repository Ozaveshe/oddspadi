#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "deploy-channel.json"), "utf8"));
const siteId = manifest?.netlify?.siteId;

if (!siteId || manifest?.product !== "OddsPadi") {
  console.error("OddsPadi deploy manifest is missing its locked Netlify site ID.");
  process.exit(1);
}

const production = process.argv.includes("--production");
const context = production ? "production" : "deploy-preview";
const message = production ? "OddsPadi verified production" : "OddsPadi verified preview";
const netlifyArgs = ["netlify", "deploy", "--site", siteId, "--context", context, "--message", message];
if (production) netlifyArgs.push("--prod");

// Netlify CLI gives NETLIFY_SITE_ID precedence over both the linked checkout
// and --site. Pin it here as well so an unrelated terminal-level site override
// can never redirect an OddsPadi release.
const deployEnv = { ...process.env, NETLIFY_SITE_ID: siteId };
delete deployEnv.SITE_ID;

const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", netlifyArgs, {
  cwd: workspaceRoot,
  env: deployEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true
});

if (result.error) {
  console.error(`Netlify deploy could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
