/**
 * Kept as a TS string rather than a .sql asset so it survives the TS build without a separate
 * asset-copy step, and applied idempotently (`IF NOT EXISTS`) by migrate.ts on startup.
 *
 * Scope note: `inventory` is keyed by warehouse only (no item column) — v1 has exactly one SKU,
 * and ticket 03's own reference query (`UPDATE inventory ... WHERE warehouse_id = :warehouseId`)
 * confirms item isn't part of this table yet. See config.ts's DEFAULT_ITEM_ID comment for how the
 * domain layer bridges that with the (future-proofed) `Inventory` type from ticket 02.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS warehouses (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  warehouse_id  INTEGER PRIMARY KEY REFERENCES warehouses (id),
  stock         INTEGER NOT NULL CHECK (stock >= 0)
);
`;
