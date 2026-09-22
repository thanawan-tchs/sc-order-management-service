import { Migration } from "./migration";

export const migration_0006_item_aware_inventory_and_orders: Migration = {
  id: "0006_item_aware_inventory_and_orders",
  statements: [
    `INSERT INTO items (name, price, currency, weight_kg) VALUES ('Standard Unit', 15000, 'USD', 0.365)`,

    `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items (id)`,
    `UPDATE inventory SET item_id = (SELECT id FROM items ORDER BY id LIMIT 1) WHERE item_id IS NULL`,
    `ALTER TABLE inventory ALTER COLUMN item_id SET NOT NULL`,
    `ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_pkey`,
    `ALTER TABLE inventory ADD PRIMARY KEY (warehouse_id, item_id)`,

    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items (id)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_name TEXT`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_price INTEGER`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_weight_kg DOUBLE PRECISION`,
    `UPDATE orders SET
       item_id = (SELECT id FROM items ORDER BY id LIMIT 1),
       item_name = (SELECT name FROM items ORDER BY id LIMIT 1),
       item_price = (SELECT price FROM items ORDER BY id LIMIT 1),
       item_weight_kg = (SELECT weight_kg FROM items ORDER BY id LIMIT 1)
     WHERE item_id IS NULL`,
    `ALTER TABLE orders ALTER COLUMN item_id SET NOT NULL`,
    `ALTER TABLE orders ALTER COLUMN item_name SET NOT NULL`,
    `ALTER TABLE orders ALTER COLUMN item_price SET NOT NULL`,
    `ALTER TABLE orders ALTER COLUMN item_weight_kg SET NOT NULL`,
  ],
};
