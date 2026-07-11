const { spawnSync } = require("node:child_process");

const nextArgs = ["node_modules/next/dist/bin/next", "build", ...process.argv.slice(2)];
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1" };
const major = Number(process.versions.node.split(".")[0]);

const run = major === 22
  ? {
      command: process.execPath,
      args: nextArgs
    }
  : {
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["-y", "-p", "node@22", "node", ...nextArgs]
    };

if (major !== 22) {
  console.log(`OddsPadi build uses Node 22 for Next.js production builds. Current Node is ${process.versions.node}; rerouting build through node@22.`);
}

const result = spawnSync(run.command, run.args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
