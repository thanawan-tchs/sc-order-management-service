import { Pool, PoolClient } from "pg";
import { config } from "@config";
import { logger } from "../../observability/logger";

export type QueryExecutor = Pool | PoolClient;

let pool: Pool | undefined;

function createPool(): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
  });
}

export function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function connectPool(): Promise<void> {
  await getPool().query("SELECT 1");
  logger.info("connected to database");
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
