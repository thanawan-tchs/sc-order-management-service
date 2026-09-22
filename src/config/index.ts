import { Currency } from "@domain/money";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5433/orders",

  logLevel: process.env.LOG_LEVEL ?? "info",

  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbIdleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5_000),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 10_000),

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000),
  headersTimeoutMs: Number(process.env.HEADERS_TIMEOUT_MS ?? 31_000),

  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000),

  redisUrl: process.env.REDIS_URL,
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 60),
};

export const SHIPPING_RATE_PER_KG_KM = 1;

export const CURRENCY: Currency = "USD";

export const SEED_ITEMS = [{ name: "Standard Unit", price: 15000, currency: CURRENCY, weightKg: 0.365 }];

export const SEED_WAREHOUSES = [
  { name: "Los Angeles", latitude: 33.9425, longitude: -118.408056, stock: 355 },
  { name: "New York", latitude: 40.639722, longitude: -73.778889, stock: 578 },
  { name: "São Paulo", latitude: -23.435556, longitude: -46.473056, stock: 265 },
  { name: "Paris", latitude: 49.009722, longitude: 2.547778, stock: 694 },
  { name: "Warsaw", latitude: 52.165833, longitude: 20.967222, stock: 245 },
  { name: "Hong Kong", latitude: 22.308889, longitude: 113.914444, stock: 419 },
];
