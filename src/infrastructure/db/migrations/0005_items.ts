import { Migration } from "./migration";

export const migration_0005_items: Migration = {
  id: "0005_items",
  statements: [
    `CREATE TABLE IF NOT EXISTS items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      weight_kg   DOUBLE PRECISION NOT NULL CHECK (weight_kg > 0)
    )`,
  ],
};
