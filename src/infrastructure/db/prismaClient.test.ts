import { expect } from "chai";

const MODULE_PATH = require.resolve("./prismaClient");

function requireFreshModule(): typeof import("./prismaClient") {
  delete require.cache[MODULE_PATH];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./prismaClient");
}

describe("buildPoolConfig", () => {
  it("derives the pg pool config (size + timeouts) from config", async () => {
    const { config } = await import("@config");
    const { buildPoolConfig } = requireFreshModule();

    expect(buildPoolConfig()).to.deep.equal({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbIdleTimeoutMs,
      connectionTimeoutMillis: config.dbConnectionTimeoutMs,
      statement_timeout: config.dbStatementTimeoutMs,
    });
  });
});

describe("getPrismaClient", () => {
  afterEach(async () => {
    const { closePrisma } = requireFreshModule();
    await closePrisma().catch(() => undefined);
    delete require.cache[MODULE_PATH];
  });

  it("reuses the same client instance across calls instead of constructing a new one each time", () => {
    const { getPrismaClient } = requireFreshModule();

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(second).to.equal(first);
  });
});
