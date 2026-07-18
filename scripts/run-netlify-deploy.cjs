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
const productionUrl = manifest?.netlify?.productionUrl;
const gitResult = spawnSync("git", ["rev-parse", "--short=8", "HEAD"], {
  cwd: workspaceRoot,
  encoding: "utf8",
  windowsHide: true
});
const shortSha = gitResult.status === 0 ? gitResult.stdout.trim() : "candidate";
const alias = `release-${shortSha}-candidate`;
const message = production
  ? `OddsPadi production candidate ${shortSha}`
  : `OddsPadi verified preview ${shortSha}`;
const netlifyArgs = [
  "netlify",
  "deploy",
  "--site",
  siteId,
  "--context",
  "deploy-preview",
  "--alias",
  alias,
  "--message",
  message,
  "--json"
];

// Netlify CLI gives NETLIFY_SITE_ID precedence over both the linked checkout
// and --site. Pin it here as well so an unrelated terminal-level site override
// can never redirect an OddsPadi release.
const deployEnv = { ...process.env, NETLIFY_SITE_ID: siteId };
delete deployEnv.SITE_ID;

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, netlifyArgs, {
  cwd: workspaceRoot,
  env: deployEnv,
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true
});

if (result.error) {
  console.error(`Netlify deploy could not start: ${result.error.message}`);
  process.exit(1);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

let deploy;
try {
  deploy = JSON.parse(result.stdout.trim());
} catch {
  console.error("Netlify did not return parseable deploy metadata; production was not changed.");
  process.exit(1);
}

const deployId = deploy.deploy_id || deploy.id;
const deployUrl = deploy.deploy_url || deploy.ssl_url || deploy.url;
if (!deployId || !deployUrl) {
  console.error("Netlify omitted the candidate deploy ID or URL; production was not changed.");
  process.exit(1);
}

function smokeCheck(url) {
  const smokeScript = [
    "const url = process.env.ODDSPADI_SMOKE_URL;",
    "fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) })",
    "  .then(async (response) => {",
    "    const body = await response.text();",
    "    if (!response.ok || !body.includes('OddsPadi')) {",
    "      console.error(`Smoke check failed: ${response.status} ${url}`);",
    "      process.exit(1);",
    "    }",
    "    console.log(`Smoke check passed: ${response.status} ${url}`);",
    "  })",
    "  .catch((error) => { console.error(error.message); process.exit(1); });"
  ].join("\n");
  return spawnSync(process.execPath, ["-e", smokeScript], {
    cwd: workspaceRoot,
    env: { ...deployEnv, ODDSPADI_SMOKE_URL: url },
    encoding: "utf8",
    windowsHide: true
  });
}

const candidateSmoke = smokeCheck(deployUrl);
if (candidateSmoke.stdout) process.stdout.write(candidateSmoke.stdout);
if (candidateSmoke.stderr) process.stderr.write(candidateSmoke.stderr);
if (candidateSmoke.status !== 0) {
  console.error("Candidate deploy failed closed; production was not changed.");
  process.exit(candidateSmoke.status ?? 1);
}

if (!production) process.exit(0);
if (!productionUrl) {
  console.error("OddsPadi deploy manifest is missing its production URL; candidate was not promoted.");
  process.exit(1);
}

const promoteArgs = [
  "netlify",
  "api",
  "restoreSiteDeploy",
  "--data",
  JSON.stringify({ site_id: siteId, deploy_id: deployId })
];
const promotion = spawnSync(npxCommand, promoteArgs, {
  cwd: workspaceRoot,
  env: deployEnv,
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true
});
if (promotion.stdout) process.stdout.write(promotion.stdout);
if (promotion.stderr) process.stderr.write(promotion.stderr);
if (promotion.error || promotion.status !== 0) {
  console.error("Verified candidate could not be promoted.");
  process.exit(promotion.status ?? 1);
}

const productionSmoke = smokeCheck(productionUrl);
if (productionSmoke.stdout) process.stdout.write(productionSmoke.stdout);
if (productionSmoke.stderr) process.stderr.write(productionSmoke.stderr);
process.exit(productionSmoke.status ?? 1);
