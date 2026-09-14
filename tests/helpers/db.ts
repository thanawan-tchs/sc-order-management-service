import { migrate } from "../../src/infrastructure/db/migrate";
import { getPool } from "../../src/infrastructure/db/pool";
import { seed } from "../../src/infrastructure/db/seed";

/**
 * Full reset for a test file: (re)creates the schema, wipes it, then reseeds the fixed 6-
 * warehouse dataset. `RESTART IDENTITY` resets id sequences back to 1 so tests can assert on
 * stable, predictable ids run to run. Every table with a foreign key into `warehouses` or
 * `orders` is listed explicitly (not left to CASCADE alone) so a table added later can't be
 * silently forgotten and leak state between tests the way `orders` itself once did (cascading
 * off `warehouses` only reaches tables that reference *it* directly, not transitively).
 * `order_number_seq` is a standalone sequence (ticket 10), so it needs its own restart —
 * `RESTART IDENTITY` only resets sequences owned by a table's SERIAL/IDENTITY columns.
 */
export async function resetTestDb(): Promise<void> {
  const pool = getPool();
  await migrate();
  await pool.query(
    "TRUNCATE idempotency_keys, order_allocations, orders, inventory, warehouses RESTART IDENTITY CASCADE"
  );
  await pool.query("ALTER SEQUENCE order_number_seq RESTART WITH 1");
  await seed();
}
