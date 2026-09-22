import { PoolClient } from "pg";
import { logger } from "../../observability/logger";
import { getPool } from "./pool";

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
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    logger.debug({ operation, duration: Math.round(durationSeconds * 1000) }, "database transaction finished");
    client.release();
  }
}
