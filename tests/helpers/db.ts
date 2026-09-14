import { migrate } from "../../src/infrastructure/db/migrate";
import { getPool } from "../../src/infrastructure/db/pool";
import { seed } from "../../src/infrastructure/db/seed";

/**
 * Full reset for a test file: (re)creates the schema, wipes it, then reseeds the fixed 6-
 * warehouse dataset. `RESTART IDENTITY` resets the warehouse id sequence back to 1 so tests can
 * assert on stable, predictable ids run to run.
 */
export async function resetTestDb(): Promise<void> {
  const pool = getPool();
  await migrate();
  await pool.query("TRUNCATE inventory, warehouses RESTART IDENTITY CASCADE");
  await seed();
}
