import { Pool } from "pg";
import { getPool } from "./pool";
import { SEED_ITEMS, SEED_WAREHOUSES } from "../../config";

/**
 * Seeds `items` if empty, then the 6 warehouses + their starting stock (of that item) if
 * `warehouses` is empty — each table checked independently, so this is safe to call whenever
 * only one of the two has already been seeded (e.g. a database migration 0006 already backfilled
 * with its own item, where `items` is non-empty but this function has never run against it).
 * Returns the seeded item's id (a UUID, ticket "use item id as uuid format") — there's no fixed
 * value to hardcode/assert on the way there used to be with an auto-incrementing integer id, so
 * callers (tests included) that need it must read it from here.
 */
export async function seed(): Promise<string> {
  const pool = getPool();

  const itemId = await seedItems(pool);
  await seedWarehouses(pool, itemId);
  return itemId;
}

async function seedItems(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM items ORDER BY id LIMIT 1");
  if (rows[0]) return rows[0].id;

  const [item] = SEED_ITEMS;
  const { rows: inserted } = await pool.query<{ id: string }>(
    "INSERT INTO items (name, price_cents, weight_kg) VALUES ($1, $2, $3) RETURNING id",
    [item.name, item.priceCents, item.weightKg]
  );
  return inserted[0].id;
}

async function seedWarehouses(pool: Pool, itemId: string): Promise<void> {
  const { rows } = await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM warehouses");
  if (rows[0].count > 0) return;

  for (const warehouse of SEED_WAREHOUSES) {
    const { rows: inserted } = await pool.query<{ id: number }>(
      "INSERT INTO warehouses (name, latitude, longitude) VALUES ($1, $2, $3) RETURNING id",
      [warehouse.name, warehouse.latitude, warehouse.longitude]
    );
    await pool.query("INSERT INTO inventory (warehouse_id, item_id, stock) VALUES ($1, $2, $3)", [
      inserted[0].id,
      itemId,
      warehouse.stock,
    ]);
  }
}
