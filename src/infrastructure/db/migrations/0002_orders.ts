import { Migration } from "./migration";

export const migration_0002_orders: Migration = {
  id: "0002_orders",
  statements: [
    `CREATE SEQUENCE IF NOT EXISTS order_number_seq`,

    `CREATE TABLE IF NOT EXISTS orders (
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
    )`,
  ],
};
