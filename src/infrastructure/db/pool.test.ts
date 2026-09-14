import { afterEach, describe, expect, it, vi } from "vitest";

const PoolMock = vi.fn().mockImplementation(() => ({ end: vi.fn(async () => undefined) }));
vi.mock("pg", () => ({ Pool: PoolMock }));

afterEach(() => {
  vi.resetModules();
  PoolMock.mockClear();
});

describe("getPool", () => {
  it("configures the pool from config (connection-pool size, timeouts, statement_timeout)", async () => {
    const { config } = await import("../../config");
    const { getPool } = await import("./pool");

    getPool();

    expect(PoolMock).toHaveBeenCalledWith({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbIdleTimeoutMs,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
      statement_timeout: config.dbStatementTimeoutMs,
    });
  });

  it("reuses the same pool instance across calls instead of constructing a new one each time", async () => {
    const { getPool } = await import("./pool");

    const first = getPool();
    const second = getPool();

    expect(second).toBe(first);
    expect(PoolMock).toHaveBeenCalledTimes(1);
  });
});
