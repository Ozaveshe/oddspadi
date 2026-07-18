import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Keep Windows release runs from spawning a worker per logical core and
    // starving module transforms. Failure-path storage tests legitimately
    // exercise several dynamic imports before their bounded network timeout.
    maxWorkers: 4,
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
