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

-- Backs order number generation (see orderRepository.ts). A sequence's nextval() is atomic under
-- Postgres MVCC — concurrent submissions can never be handed the same value — which is what
-- ticket 10 asks for ("safe under concurrent creation") without needing any locking of our own.
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

CREATE TABLE IF NOT EXISTS orders (
  id                            SERIAL PRIMARY KEY,
  order_number                  TEXT NOT NULL UNIQUE,
  quantity                      INTEGER NOT NULL CHECK (quantity > 0),
  destination_latitude          DOUBLE PRECISION NOT NULL,
  destination_longitude         DOUBLE PRECISION NOT NULL,
  subtotal_cents                INTEGER NOT NULL,
  discount_rate                 DOUBLE PRECISION NOT NULL,
  discount_cents                INTEGER NOT NULL,
  amount_after_discount_cents   INTEGER NOT NULL,
  shipping_cents                INTEGER NOT NULL,
  total_cents                   INTEGER NOT NULL,
  currency                      TEXT NOT NULL,
  status                        TEXT NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_allocations (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders (id),
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses (id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  distance_km     DOUBLE PRECISION NOT NULL,
  shipping_cents  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_allocations_order_id ON order_allocations (order_id);

-- Ticket 13: one row per successfully-submitted Idempotency-Key, written in the SAME transaction
-- as the order it maps to (orderRepository.ts's recordIdempotencyKey). That's what makes "a
-- failed transaction does not consume idempotency state" true by construction — if the order
-- insert or an inventory decrement rolls back, this row was never committed either, so the key
-- remains free to retry. The PRIMARY KEY is the actual concurrency-safety mechanism for "same key
-- submitted concurrently": Postgres's own uniqueness check is what decides which of two racing
-- transactions wins, the same pattern used for order_number_seq/decrementInventory.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  order_number  TEXT NOT NULL REFERENCES orders (order_number),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
