import { Migration } from "./migration";

export const migration_0001_warehouses_and_inventory: Migration = {
  id: "0001_warehouses_and_inventory",
  statements: [
    `CREATE TABLE IF NOT EXISTS warehouses (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      latitude   DOUBLE PRECISION NOT NULL,
      longitude  DOUBLE PRECISION NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS inventory (
      warehouse_id  INTEGER PRIMARY KEY REFERENCES warehouses (id),
      stock         INTEGER NOT NULL CHECK (stock >= 0)
    )`,
  ],
};
