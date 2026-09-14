import { Migration } from "./migration";

/**
 * Ticket 13: one row per successfully-submitted Idempotency-Key, written in the SAME transaction
 * as the order it maps to (orderRepository.ts's recordIdempotencyKey). That's what makes "a
 * failed transaction does not consume idempotency state" true by construction — if the order
 * insert or an inventory decrement rolls back, this row was never committed either, so the key
 * remains free to retry. The PRIMARY KEY is the actual concurrency-safety mechanism for "same key
 * submitted concurrently": Postgres's own uniqueness check is what decides which of two racing
 * transactions wins, the same pattern used for order_number_seq/decrementInventory.
 */
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
