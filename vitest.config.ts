import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src/app.ts"),
      "@config": path.resolve(__dirname, "src/config/index.ts"),
      "@config/": path.resolve(__dirname, "src/config") + "/",
      "@domain/": path.resolve(__dirname, "src/domain") + "/",
      "@application/": path.resolve(__dirname, "src/application") + "/",
      "@controllers/": path.resolve(__dirname, "src/controllers") + "/",
      "@repositories/": path.resolve(__dirname, "src/repositories") + "/",
      "@infrastructure/": path.resolve(__dirname, "src/infrastructure") + "/",
      "@middleware/": path.resolve(__dirname, "src/middleware") + "/",
      "@observability/": path.resolve(__dirname, "src/observability") + "/",
      "@routes/": path.resolve(__dirname, "src/routes") + "/",
      "@utils/": path.resolve(__dirname, "src/utils") + "/",
      "@tests/": path.resolve(__dirname, "tests") + "/",
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    testTimeout: 10000,
    hookTimeout: 60000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/config/**", "src/**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
