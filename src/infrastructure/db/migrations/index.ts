import { migration_0001_warehouses_and_inventory } from "./0001_warehouses_and_inventory";
import { migration_0002_orders } from "./0002_orders";
import { migration_0003_order_allocations } from "./0003_order_allocations";
import { migration_0004_idempotency_keys } from "./0004_idempotency_keys";
import { migration_0005_items } from "./0005_items";
import { migration_0006_item_aware_inventory_and_orders } from "./0006_item_aware_inventory_and_orders";
import { Migration } from "./migration";

export const MIGRATIONS: readonly Migration[] = [
  migration_0001_warehouses_and_inventory,
  migration_0002_orders,
  migration_0003_order_allocations,
  migration_0004_idempotency_keys,
  migration_0005_items,
  migration_0006_item_aware_inventory_and_orders,
];
