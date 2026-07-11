#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ENV_FILE = ".env.local";
const KEY = "ODDSPADI_ADMIN_TOKEN";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function parseValue(contents) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith(`${KEY}=`));
  if (!line) return null;
  return line.slice(line.indexOf("=") + 1).trim();
}

function ensureTrailingNewline(contents) {
  return contents && !contents.endsWith("\n") ? `${contents}\n` : contents;
}

function upsertToken(contents, token) {
  const lines = contents.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().startsWith(`${KEY}=`));

  if (index >= 0) {
    lines[index] = `${KEY}=${token}`;
    return lines.join("\n").replace(/\n{3,}$/g, "\n\n");
  }

  return `${ensureTrailingNewline(contents)}${KEY}=${token}\n`;
}

function createToken() {
  return `op_admin_${crypto.randomBytes(32).toString("base64url")}`;
}

function printResult(result) {
  if (hasFlag("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("OddsPadi local admin token");
  console.log(`Status: ${result.status}`);
  console.log(`File: ${result.file}`);
  console.log(`Key: ${KEY}`);
  if (result.changed) console.log("Restart the dev server so Next.js reloads the new environment value.");
}

function main() {
  const envPath = path.join(process.cwd(), ENV_FILE);
  const contents = readFileIfPresent(envPath);
  const existingValue = parseValue(contents);
  const checkOnly = hasFlag("--check");

  if (existingValue) {
    printResult({
      status: "already-configured",
      file: ENV_FILE,
      changed: false
    });
    return;
  }

  if (checkOnly) {
    printResult({
      status: "missing",
      file: ENV_FILE,
      changed: false
    });
    process.exitCode = 1;
    return;
  }

  const token = createToken();
  fs.writeFileSync(envPath, upsertToken(contents, token), {
    encoding: "utf8",
    mode: 0o600
  });

  printResult({
    status: existingValue === "" ? "filled-blank-value" : "created",
    file: ENV_FILE,
    changed: true
  });
}

main();
