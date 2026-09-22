import { migrate } from "@infrastructure/db/migrate";
import { getPool } from "@infrastructure/db/pool";
import { seed } from "@infrastructure/db/seed";

export async function resetTestDb(): Promise<string> {
  const pool = getPool();
  await migrate();
  await pool.query(
    "TRUNCATE idempotency_keys, order_allocations, orders, inventory, warehouses, items RESTART IDENTITY CASCADE"
  );
  await pool.query("ALTER SEQUENCE order_number_seq RESTART WITH 1");
  return seed();
}
