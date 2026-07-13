#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const mode = process.argv[2] || "status";
if (!new Set(["status", "sync"]).has(mode)) {
  console.error("Usage: node scripts/worktree-release.cjs <status|sync>");
  process.exit(2);
}

function run(cwd, args, options = {}) {
  const output = execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...options
  });
  return typeof output === "string" ? output.trim() : "";
}

const root = run(process.cwd(), ["rev-parse", "--show-toplevel"]);

function fetchMain() {
  run(root, ["fetch", "origin", "main", "--prune"]);
}

function parseWorktrees() {
  const blocks = run(root, ["worktree", "list", "--porcelain"])
    .split(/\r?\n\r?\n/u)
    .filter(Boolean);

  return blocks.map((block) => {
    const entry = {};
    for (const line of block.split(/\r?\n/u)) {
      const separator = line.indexOf(" ");
      const key = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? true : line.slice(separator + 1);
      entry[key] = value;
    }
    return entry;
  });
}

function inspect(entry) {
  const cwd = entry.worktree;
  const dirtyOutput = run(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const [aheadRaw, behindRaw] = run(cwd, ["rev-list", "--left-right", "--count", "HEAD...origin/main"])
    .split(/\s+/u);
  return {
    cwd,
    branch: typeof entry.branch === "string" ? entry.branch.replace(/^refs\/heads\//u, "") : "detached",
    detached: entry.detached === true || !entry.branch,
    head: run(cwd, ["rev-parse", "--short=12", "HEAD"]),
    dirty: dirtyOutput ? dirtyOutput.split(/\r?\n/u).length : 0,
    ahead: Number(aheadRaw),
    behind: Number(behindRaw)
  };
}

function print(entries) {
  console.log("OddsPadi worktree state against origin/main:");
  for (const entry of entries) {
    console.log(
      `- ${entry.cwd} | ${entry.branch} | ${entry.head} | dirty=${entry.dirty} ahead=${entry.ahead} behind=${entry.behind}`
    );
  }
}

function sync(entries) {
  let blocked = false;
  for (const entry of entries) {
    if (entry.dirty > 0) {
      console.error(`BLOCKED ${entry.cwd}: ${entry.dirty} uncommitted path(s).`);
      blocked = true;
      continue;
    }

    if (entry.branch === "main") {
      if (entry.ahead > 0) {
        console.error(`BLOCKED ${entry.cwd}: main has ${entry.ahead} unpushed commit(s).`);
        blocked = true;
      } else if (entry.behind > 0) {
        run(entry.cwd, ["merge", "--ff-only", "origin/main"], { stdio: "inherit" });
      }
      continue;
    }

    if (entry.detached) {
      if (entry.ahead > 0) {
        console.error(`BLOCKED ${entry.cwd}: detached HEAD has ${entry.ahead} commit(s) not in origin/main.`);
        blocked = true;
      } else if (entry.behind > 0) {
        run(entry.cwd, ["checkout", "--detach", "origin/main"], { stdio: "inherit" });
      }
      continue;
    }

    if (entry.ahead === 0 && entry.behind > 0) {
      run(entry.cwd, ["merge", "--ff-only", "origin/main"], { stdio: "inherit" });
    } else if (entry.ahead > 0 && entry.behind > 0) {
      console.error(`BLOCKED ${entry.cwd}: branch ${entry.branch} has diverged; rebase or merge it explicitly.`);
      blocked = true;
    }
  }

  return blocked;
}

try {
  fetchMain();
  const before = parseWorktrees().map(inspect);
  print(before);

  if (mode === "sync") {
    const blocked = sync(before);
    const after = parseWorktrees().map(inspect);
    console.log("\nAfter safe synchronization:");
    print(after);
    if (blocked) process.exit(1);
  }
} catch (error) {
  const detail = error?.stderr?.toString().trim() || error?.message || String(error);
  console.error(`OddsPadi worktree ${mode} failed: ${detail}`);
  process.exit(1);
}
