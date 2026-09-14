import { Pool, PoolClient } from "pg";
import { config } from "../../config";

/**
 * Anything repositories can run a query against — either the shared pool (each call gets its
 * own connection, auto-committed) or a checked-out client already inside a transaction (so a
 * later ticket, e.g. atomic order submission, can pass its own client through these same
 * repository functions instead of duplicating queries inline).
 */
export type QueryExecutor = Pool | PoolClient;

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

/** Test-only escape hatch: closes the current pool so a fresh one can be created (e.g. after
 *  pointing DATABASE_URL at a different database, or to let a test process exit cleanly). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
