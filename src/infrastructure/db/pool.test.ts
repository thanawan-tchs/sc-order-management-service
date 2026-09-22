import { expect } from "chai";

const POOL_MODULE_PATH = require.resolve("./pool");

function requireFreshPoolModule(): typeof import("./pool") {
  delete require.cache[POOL_MODULE_PATH];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./pool");
}

describe("getPool", () => {
  afterEach(async () => {
    const { closePool } = requireFreshPoolModule();
    await closePool().catch(() => undefined);
    delete require.cache[POOL_MODULE_PATH];
  });

  it("configures the pool from config (connection-pool size, timeouts, statement_timeout)", async () => {
    const { config } = await import("../../config");
    const { getPool } = requireFreshPoolModule();

    const pool = getPool();

    expect(pool.options.connectionString).to.equal(config.databaseUrl);
    expect(pool.options.max).to.equal(config.dbPoolMax);
    expect(pool.options.idleTimeoutMillis).to.equal(config.dbIdleTimeoutMs);
    expect(pool.options.connectionTimeoutMillis).to.equal(config.dbConnectionTimeoutMs);
    expect(pool.options.statement_timeout).to.equal(config.dbStatementTimeoutMs);
  });

  it("reuses the same pool instance across calls instead of constructing a new one each time", () => {
    const { getPool } = requireFreshPoolModule();

    const first = getPool();
    const second = getPool();

    expect(second).to.equal(first);
  });
});
