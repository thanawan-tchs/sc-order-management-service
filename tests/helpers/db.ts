import { migrate } from "../../src/infrastructure/db/migrate";
import { getPool } from "../../src/infrastructure/db/pool";
import { seed } from "../../src/infrastructure/db/seed";

/**
 * Full reset for a test file: (re)creates the schema, wipes it, then reseeds the fixed 6-
 * warehouse dataset. `RESTART IDENTITY` resets id sequences back to 1 so tests can assert on
 * stable, predictable ids run to run. `order_allocations`/`orders` are listed explicitly (not
 * left to CASCADE from `warehouses`) — a cascade off `warehouses` only reaches tables that
 * reference *it*, i.e. `order_allocations`, and stops there, leaving `orders` rows orphaned.
 * `order_number_seq` is a standalone sequence (ticket 10), so it needs its own restart —
 * `RESTART IDENTITY` only resets sequences owned by a table's SERIAL/IDENTITY columns.
 */
export async function resetTestDb(): Promise<void> {
  const pool = getPool();
  await migrate();
  await pool.query("TRUNCATE order_allocations, orders, inventory, warehouses RESTART IDENTITY CASCADE");
  await pool.query("ALTER SEQUENCE order_number_seq RESTART WITH 1");
  await seed();
}
