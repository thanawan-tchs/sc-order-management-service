import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    testTimeout: 10000,
    // Multiple test files share one real Postgres test database (tests/helpers/db.ts's
    // resetTestDb truncates + reseeds it). Running files in parallel (Vitest's default) lets
    // one file's truncate race another file's in-flight queries against the same tables — so
    // files run one at a time. Tests within a single file still run in the usual order.
    fileParallelism: false,
  },
});
