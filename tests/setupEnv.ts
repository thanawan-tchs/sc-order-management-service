/**
 * Vitest setup file (see vitest.config.ts's `setupFiles`) — runs before any test file's own
 * imports, so by the time a test does `import { config } from "../src/config"`, DATABASE_URL
 * already points at the test database. Keeps integration tests from ever touching dev data.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5433/orders_test";
