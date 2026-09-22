import { Pool } from "pg";
import { getPool } from "./pool";
import { SEED_ITEMS, SEED_WAREHOUSES } from "@config";

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
    "INSERT INTO items (name, price, currency, weight_kg) VALUES ($1, $2, $3, $4) RETURNING id",
    [item.name, item.price, item.currency, item.weightKg]
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
