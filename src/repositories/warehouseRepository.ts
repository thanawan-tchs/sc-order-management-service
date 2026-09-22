import { InsufficientStockError } from "../domain/errors";
import { Inventory, Warehouse } from "../domain/types";
import { QueryExecutor, getPool } from "../infrastructure/db/pool";

interface WarehouseRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

interface InventoryRow {
  warehouse_id: number;
  item_id: string;
  stock: number;
}

function mapWarehouseRow(row: WarehouseRow): Warehouse {
  return { id: row.id, name: row.name, latitude: row.latitude, longitude: row.longitude };
}

function mapInventoryRow(row: InventoryRow): Inventory {
  return { warehouseId: row.warehouse_id, itemId: row.item_id, stock: row.stock };
}

export async function getAllWarehouses(executor: QueryExecutor = getPool()): Promise<Warehouse[]> {
  const { rows } = await executor.query<WarehouseRow>(
    "SELECT id, name, latitude, longitude FROM warehouses ORDER BY id"
  );
  return rows.map(mapWarehouseRow);
}

export async function getWarehouse(
  id: number,
  executor: QueryExecutor = getPool()
): Promise<Warehouse | undefined> {
  const { rows } = await executor.query<WarehouseRow>(
    "SELECT id, name, latitude, longitude FROM warehouses WHERE id = $1",
    [id]
  );
  return rows[0] ? mapWarehouseRow(rows[0]) : undefined;
}

/** Stock of `itemId` at `warehouseId` — `inventory` is keyed by `(warehouse_id, item_id)`, so
 *  both are required to identify a row. */
export async function getInventory(
  warehouseId: number,
  itemId: string,
  executor: QueryExecutor = getPool()
): Promise<Inventory | undefined> {
  const { rows } = await executor.query<InventoryRow>(
    "SELECT warehouse_id, item_id, stock FROM inventory WHERE warehouse_id = $1 AND item_id = $2",
    [warehouseId, itemId]
  );
  return rows[0] ? mapInventoryRow(rows[0]) : undefined;
}

/**
 * Atomically decrements `itemId`'s stock at `warehouseId`. The `WHERE ... AND stock >= $1` guard
 * makes the single UPDATE statement itself the concurrency-safety mechanism (Postgres evaluates
 * and applies an UPDATE's row changes atomically) — no explicit transaction/lock is needed here
 * for a single-row deduction to be race-free (see ticket 03). Throws InsufficientStockError, and
 * leaves stock untouched, if the guard fails (missing warehouse/item pair or insufficient stock)
 * — i.e. if the affected row count isn't exactly 1.
 *
 * `warehouse_id AND item_id` together (not `warehouse_id` alone) are what target exactly one row
 * now that `inventory` is keyed by `(warehouse_id, item_id)` rather than `warehouse_id` alone.
 */
export async function decrementInventory(
  warehouseId: number,
  itemId: string,
  quantity: number,
  executor: QueryExecutor = getPool()
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }

  const result = await executor.query(
    "UPDATE inventory SET stock = stock - $1 WHERE warehouse_id = $2 AND item_id = $3 AND stock >= $1",
    [quantity, warehouseId, itemId]
  );

  if (result.rowCount !== 1) {
    throw new InsufficientStockError(warehouseId, quantity);
  }
}
