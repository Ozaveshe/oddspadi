#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(workspaceRoot, "deploy-channel.json");
const expected = {
  schemaVersion: 1,
  product: "OddsPadi",
  releaseBranch: "main",
  netlify: {
    siteId: "3ba4bf38-60ec-4bc4-b49f-aca9495a9aa2",
    siteName: "oddspadi",
    productionUrl: "https://oddspadi.com"
  },
  supabase: {
    projectRef: "wncwtzqipnoqwmqlznqn",
    projectUrl: "https://wncwtzqipnoqwmqlznqn.supabase.co"
  }
};

const online = process.argv.includes("--online") || process.argv.includes("--production");
const production = process.argv.includes("--production");
const failures = [];

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    failures.push(`${label} is missing or invalid JSON.`);
    return null;
  }
}

function assertEqual(label, actual, wanted) {
  if (actual !== wanted) failures.push(`${label} does not match the locked OddsPadi deploy channel.`);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }).trim();
}

function npx(args) {
  if (process.platform !== "win32") return run("npx", args);
  const command = ["npx", ...args].join(" ");
  return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command]);
}

function envValue(env, key) {
  const value = env?.[key];
  if (typeof value === "string") return value;
  if (value && typeof value.value === "string") return value.value;
  return "";
}

const manifest = readJson(manifestPath, "deploy-channel.json");
const packageJson = readJson(path.join(workspaceRoot, "package.json"), "package.json");
const linkState = readJson(path.join(workspaceRoot, ".netlify", "state.json"), ".netlify/state.json");

if (manifest) {
  assertEqual("schemaVersion", manifest.schemaVersion, expected.schemaVersion);
  assertEqual("product", manifest.product, expected.product);
  assertEqual("releaseBranch", manifest.releaseBranch, expected.releaseBranch);
  assertEqual("Netlify site ID", manifest.netlify?.siteId, expected.netlify.siteId);
  assertEqual("Netlify site name", manifest.netlify?.siteName, expected.netlify.siteName);
  assertEqual("Netlify production URL", manifest.netlify?.productionUrl, expected.netlify.productionUrl);
  assertEqual("Supabase project ref", manifest.supabase?.projectRef, expected.supabase.projectRef);
  assertEqual("Supabase project URL", manifest.supabase?.projectUrl, expected.supabase.projectUrl);
}

assertEqual("package name", packageJson?.name, "oddspadi");
assertEqual("linked Netlify site ID", linkState?.siteId, expected.netlify.siteId);

let branch = "";
try {
  branch = process.env.BRANCH?.trim() || run("git", ["branch", "--show-current"]);
} catch {
  failures.push("The Git release branch could not be determined.");
}

if (production) assertEqual("production release branch", branch, expected.releaseBranch);

if (online) {
  try {
    const status = JSON.parse(npx(["netlify", "status", "--json"]));
    const site = status.siteData || {};
    assertEqual("authenticated Netlify site ID", site["site-id"], expected.netlify.siteId);
    assertEqual("authenticated Netlify site name", site["site-name"], expected.netlify.siteName);
    assertEqual("authenticated Netlify site URL", site["site-url"], expected.netlify.productionUrl);
  } catch {
    failures.push("Netlify authentication or linked-site verification failed.");
  }

  try {
    const env = JSON.parse(
      npx([
        "netlify",
        "env:list",
        "--json",
        "--context",
        "production",
        "--site",
        expected.netlify.siteId
      ])
    );
    const required = {
      SUPABASE_PROJECT_REF: expected.supabase.projectRef,
      SUPABASE_URL: expected.supabase.projectUrl,
      NEXT_PUBLIC_SUPABASE_URL: expected.supabase.projectUrl,
      NEXT_PUBLIC_SITE_URL: expected.netlify.productionUrl
    };
    for (const [key, wanted] of Object.entries(required)) {
      if (envValue(env, key) !== wanted) failures.push(`Netlify production variable ${key} is missing or points outside OddsPadi.`);
    }
  } catch {
    failures.push("Netlify production environment verification failed.");
  }
}

if (failures.length) {
  console.error("OddsPadi deploy-channel verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("OddsPadi deploy channel verified.");
console.log(`Release branch: ${branch || "not required"}`);
console.log(`Netlify: ${expected.netlify.siteName} (${expected.netlify.siteId}) -> ${expected.netlify.productionUrl}`);
console.log(`Supabase: ${expected.supabase.projectRef}`);
if (online) console.log("Production URL variables matched; secret values were not printed.");
