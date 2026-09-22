import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    testTimeout: 10000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/config/**", "src/**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
