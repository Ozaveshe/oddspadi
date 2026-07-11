#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_REF = "wncwtzqipnoqwmqlznqn";
const DEFAULT_BASE_URL = "http://127.0.0.1:3013";

function readDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

function valueFrom(envFile, key) {
  return process.env[key]?.trim() || envFile[key]?.trim() || "";
}

function configured(envFile, key) {
  return Boolean(valueFrom(envFile, key));
}

function sourceFor(envFile, key) {
  const sources = [];
  if (process.env[key]?.trim()) sources.push("process");
  if (envFile[key]?.trim()) sources.push(".env.local");
  return sources.length ? sources.join("+") : "missing";
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).host;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      json: text ? JSON.parse(text) : null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function envSummary(envFile) {
  const supabaseUrl = valueFrom(envFile, "SUPABASE_URL") || valueFrom(envFile, "NEXT_PUBLIC_SUPABASE_URL");
  const configuredRef = valueFrom(envFile, "SUPABASE_PROJECT_REF") || projectRefFromUrl(supabaseUrl);
  const urlRef = projectRefFromUrl(supabaseUrl);
  const groups = [
    {
      id: "supabase",
      keys: ["SUPABASE_PROJECT_REF", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
    },
    {
      id: "ai",
      keys: ["OPENAI_API_KEY", "OPENAI_DECISION_MODEL"]
    },
    {
      id: "providers",
      keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY", "API_BASKETBALL_KEY", "API_TENNIS_KEY", "THE_ODDS_API_KEY", "ODDS_API_KEY", "NEWS_API_KEY", "WEATHER_API_KEY", "OPENWEATHER_API_KEY"]
    },
    {
      id: "control",
      keys: ["ODDSPADI_ADMIN_TOKEN", "ODDSPADI_SUPABASE_MCP_PROJECT_REF"]
    }
  ];

  return {
    expectedRef: EXPECTED_REF,
    configuredRef: configuredRef || null,
    urlRef,
    targetMatchesExpected: configuredRef === EXPECTED_REF && urlRef === EXPECTED_REF,
    groups: groups.map((group) => ({
      id: group.id,
      keys: group.keys.map((key) => ({
        key,
        configured: configured(envFile, key),
        source: sourceFor(envFile, key)
      }))
    }))
  };
}

function nextActions(env, status, bootstrap) {
  const actions = [];
  if (!env.targetMatchesExpected) {
    actions.push(`Set SUPABASE_PROJECT_REF and SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL to ${EXPECTED_REF}.`);
  }

  const missingKeys = [];
  const needsAny = (label, keys) => {
    if (!keys.some((key) => env.groups.some((group) => group.keys.some((item) => item.key === key && item.configured)))) missingKeys.push(label);
  };
  needsAny("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]);
  needsAny("ODDSPADI_ADMIN_TOKEN (run npm run setup:admin-token)", ["ODDSPADI_ADMIN_TOKEN"]);
  needsAny("OPENAI_API_KEY", ["OPENAI_API_KEY"]);
  needsAny("API_FOOTBALL_KEY or APISPORTS_KEY", ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  needsAny("API_BASKETBALL_KEY or APISPORTS_KEY", ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  needsAny("API_TENNIS_KEY or SPORTS_API_KEY", ["API_TENNIS_KEY", "SPORTS_API_KEY"]);
  needsAny("THE_ODDS_API_KEY or ODDS_API_KEY", ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  if (missingKeys.length) actions.push(`Configure missing env: ${missingKeys.join(", ")}.`);

  if (status?.data?.supabase?.schema?.credentialStatus === "invalid" || bootstrap?.data?.credentials?.serverKeyRejected) {
    actions.push(`Replace SUPABASE_SERVICE_ROLE_KEY with a valid secret/service-role key from the OddsPadi Supabase project ${EXPECTED_REF}.`);
  }
  if (bootstrap?.data?.mcp && !bootstrap.data.mcp.scopedProofPasses) {
    actions.push(`Prove an OddsPadi-scoped Supabase MCP session, then set ODDSPADI_SUPABASE_MCP_PROJECT_REF=${EXPECTED_REF}.`);
  }
  if (bootstrap?.data?.checks) {
    actions.push(
      ...bootstrap.data.checks
        .filter((check) => {
          if (check.status !== "block") return false;
          if (check.id === "mcp-scope") return false;
          if (check.id === "server-keys" && bootstrap?.data?.credentials?.serverKeyRejected) return false;
          if (check.id === "provider-dry-run" && bootstrap?.data?.credentials?.serverKeyRejected) return false;
          return true;
        })
        .map((check) => check.nextAction)
        .filter(Boolean)
    );
  }
  return unique(actions).slice(0, 8);
}

function printText(report) {
  console.log("OddsPadi doctor");
  console.log(`Project: expected ${report.env.expectedRef}; configured ${report.env.configuredRef || "missing"}; url ${report.env.urlRef || "missing"}`);
  console.log(`Target: ${report.env.targetMatchesExpected ? "ok" : "check"}`);
  console.log("");
  for (const group of report.env.groups) {
    const configuredCount = group.keys.filter((item) => item.configured).length;
    console.log(`${group.id}: ${configuredCount}/${group.keys.length} configured`);
    for (const item of group.keys) {
      console.log(`  ${item.key}: ${item.configured ? "configured" : "missing"} (${item.source})`);
    }
  }
  console.log("");
  if (report.runtime.statusAvailable) {
    console.log(`Runtime status: ${report.runtime.supabaseStatus}; schema ${report.runtime.schemaStatus}; credential ${report.runtime.credentialStatus}`);
    console.log(`Bootstrap: ${report.runtime.bootstrapStatus}; key rejected ${report.runtime.serverKeyRejected ? "yes" : "no"}`);
    if (report.runtime.commandIds.length) console.log(`Commands: ${report.runtime.commandIds.join(", ")}`);
  } else {
    console.log(`Runtime status: unavailable (${report.runtime.error || "server not running"})`);
  }
  console.log("");
  console.log("Next actions:");
  for (const action of report.nextActions) console.log(`- ${action}`);
}

async function main() {
  const workspaceRoot = process.cwd();
  const envFile = readDotenv(path.join(workspaceRoot, ".env.local"));
  const baseUrl = process.env.ODDSPADI_DOCTOR_BASE_URL || DEFAULT_BASE_URL;
  const env = envSummary(envFile);

  const [statusResult, bootstrapResult] = await Promise.all([
    fetchJson(`${baseUrl}/api/sports/decision/status`),
    fetchJson(`${baseUrl}/api/sports/decision/supabase-bootstrap`)
  ]);

  const status = statusResult.ok ? statusResult.json : null;
  const bootstrap = bootstrapResult.ok ? bootstrapResult.json : null;
  const runtime = {
    statusAvailable: Boolean(status && bootstrap),
    error: statusResult.error || bootstrapResult.error || null,
    supabaseStatus: status?.data?.supabase?.status ?? null,
    schemaStatus: status?.data?.supabase?.schema?.status ?? null,
    credentialStatus: status?.data?.supabase?.schema?.credentialStatus ?? null,
    bootstrapStatus: bootstrap?.data?.status ?? null,
    serverKeyRejected: Boolean(bootstrap?.data?.credentials?.serverKeyRejected),
    commandIds: Array.isArray(bootstrap?.data?.commands) ? bootstrap.data.commands.map((command) => command.id) : []
  };
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    env,
    runtime,
    nextActions: nextActions(env, status, bootstrap)
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Doctor failed");
  process.exitCode = 1;
});
