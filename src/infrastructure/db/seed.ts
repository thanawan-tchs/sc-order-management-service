import { getPool } from "./pool";
import { SEED_WAREHOUSES } from "../../config";

/** Seeds the 6 warehouses + their starting stock if (and only if) the table is currently empty. */
export async function seed(): Promise<void> {
  const pool = getPool();

  const { rows } = await pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM warehouses");
  if (rows[0].count > 0) return;

  for (const warehouse of SEED_WAREHOUSES) {
    const { rows: inserted } = await pool.query<{ id: number }>(
      "INSERT INTO warehouses (name, latitude, longitude) VALUES ($1, $2, $3) RETURNING id",
      [warehouse.name, warehouse.latitude, warehouse.longitude]
    );
    await pool.query("INSERT INTO inventory (warehouse_id, stock) VALUES ($1, $2)", [
      inserted[0].id,
      warehouse.stock,
    ]);
  }
}
