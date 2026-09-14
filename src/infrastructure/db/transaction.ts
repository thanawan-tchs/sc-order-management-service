import { PoolClient } from "pg";
import { logger } from "../../observability/logger";
import { databaseOperationDurationSeconds, transactionOutcomesTotal } from "../../observability/metrics";
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
 *
 * `operation` labels the duration metric/log line (ticket 17's "database operation timing") —
 * e.g. "order_submission" — so different transactional flows show up as distinct series/lines.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  operation = "transaction"
): Promise<T> {
  const client = await getPool().connect();
  const start = process.hrtime.bigint();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    transactionOutcomesTotal.inc({ outcome: "committed" });
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    transactionOutcomesTotal.inc({ outcome: "rolled_back" });
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    databaseOperationDurationSeconds.observe({ operation }, durationSeconds);
    logger.debug({ operation, duration: Math.round(durationSeconds * 1000) }, "database transaction finished");
    client.release();
  }
}
