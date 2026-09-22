import { Migration } from "./migration";

export const migration_0004_idempotency_keys: Migration = {
  id: "0004_idempotency_keys",
  statements: [
    `CREATE TABLE IF NOT EXISTS idempotency_keys (
      key           TEXT PRIMARY KEY,
      order_number  TEXT NOT NULL REFERENCES orders (order_number),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ],
};
