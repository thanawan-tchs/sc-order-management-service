export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5433/orders",

  /** pino level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent". */
  logLevel: process.env.LOG_LEVEL ?? "info",

  // Connection-pool configuration (ticket 17) — all overridable per-environment; defaults are
  // reasonable for a single small instance, not tuned for any specific production scale.
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbIdleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
  /** Postgres-enforced `statement_timeout` — aborts any single query running longer than this,
   *  server-side, regardless of what the client is doing. */
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 10_000),

  /** Node's http.Server-level timeouts — abort a request that hangs too long, independent of
   *  anything happening (or not) inside the app. */
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
  headersTimeoutMs: Number(process.env.HEADERS_TIMEOUT_MS ?? 31_000),

  /** How long graceful shutdown waits for in-flight requests + the DB pool to close before
   *  forcing exit. */
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000),
};

/** $0.01 per kilogram per kilometer, expressed in cents so shipping cost stays integer-cent-based. */
export const SHIPPING_RATE_CENTS_PER_KG_KM = 1;

/** Single-currency v1; stored per order (ticket 10) rather than assumed, so a multi-currency
 *  future doesn't require a migration to add the column. */
export const CURRENCY = "USD";

/** The one item `seed.ts` inserts if `items` is empty — same values migration 0006 uses to
 *  backfill a pre-existing database's `inventory`/`orders` rows, so a fresh database (test or
 *  dev) and a database upgraded from before the `items` table both converge on this one item. */
export const SEED_ITEMS = [{ name: "Standard Unit", priceCents: 15000, weightKg: 0.365 }];

export const SEED_WAREHOUSES = [
  { name: "Los Angeles", latitude: 33.9425, longitude: -118.408056, stock: 355 },
  { name: "New York", latitude: 40.639722, longitude: -73.778889, stock: 578 },
  { name: "São Paulo", latitude: -23.435556, longitude: -46.473056, stock: 265 },
  { name: "Paris", latitude: 49.009722, longitude: 2.547778, stock: 694 },
  { name: "Warsaw", latitude: 52.165833, longitude: 20.967222, stock: 245 },
  { name: "Hong Kong", latitude: 22.308889, longitude: 113.914444, stock: 419 },
];
