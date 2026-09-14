import { PoolClient } from "pg";
import { getPool } from "./pool";

/**
 * Runs `fn` inside a single Postgres transaction: BEGIN, run `fn` with a checked-out client,
 * COMMIT on success, ROLLBACK on any thrown error (re-thrown after rollback so the caller still
 * sees the original failure). The client is always released back to the pool.
 *
 * This is the whole mechanism behind ticket 11's atomic order submission: every repository call
 * made with the client `fn` receives becomes part of the same transaction, so a failure at any
 * point (invalid order, a losing race for contested stock, anything else) undoes every write
 * `fn` made before it, not just the one that failed.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
