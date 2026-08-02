import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next compiles JSX with the automatic runtime; without this, components
  // rendered in tests fail on "React is not defined" and every .tsx test would
  // need a React import the app itself does not use.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // .tsx so the cross-surface suite can render real components as JSX rather
    // than nested createElement calls.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    // Keep Windows release runs from spawning a worker per logical core and
    // starving module transforms. Failure-path storage tests legitimately
    // exercise several dynamic imports before their bounded network timeout.
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 60_000
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
