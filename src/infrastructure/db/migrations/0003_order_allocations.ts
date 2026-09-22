import { Migration } from "./migration";

export const migration_0003_order_allocations: Migration = {
  id: "0003_order_allocations",
  statements: [
    `CREATE TABLE IF NOT EXISTS order_allocations (
      id              SERIAL PRIMARY KEY,
      order_id        INTEGER NOT NULL REFERENCES orders (id),
      warehouse_id    INTEGER NOT NULL REFERENCES warehouses (id),
      quantity        INTEGER NOT NULL CHECK (quantity > 0),
      distance_km     DOUBLE PRECISION NOT NULL,
      shipping        INTEGER NOT NULL,
      currency        TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_order_allocations_order_id ON order_allocations (order_id)`,
  ],
};
