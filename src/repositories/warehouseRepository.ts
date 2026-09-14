import { DEFAULT_ITEM_ID } from "../config";
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
  stock: number;
}

function mapWarehouseRow(row: WarehouseRow): Warehouse {
  return { id: row.id, name: row.name, latitude: row.latitude, longitude: row.longitude };
}

function mapInventoryRow(row: InventoryRow): Inventory {
  // v1 has exactly one SKU — see config.ts's DEFAULT_ITEM_ID comment.
  return { warehouseId: row.warehouse_id, itemId: DEFAULT_ITEM_ID, stock: row.stock };
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

export async function getInventory(
  warehouseId: number,
  executor: QueryExecutor = getPool()
): Promise<Inventory | undefined> {
  const { rows } = await executor.query<InventoryRow>(
    "SELECT warehouse_id, stock FROM inventory WHERE warehouse_id = $1",
    [warehouseId]
  );
  return rows[0] ? mapInventoryRow(rows[0]) : undefined;
}

/**
 * Atomically decrements a warehouse's stock. The `WHERE ... AND stock >= $1` guard makes the
 * single UPDATE statement itself the concurrency-safety mechanism (Postgres evaluates and
 * applies an UPDATE's row changes atomically) — no explicit transaction/lock is needed here for
 * a single-warehouse deduction to be race-free (see ticket 03). Throws InsufficientStockError,
 * and leaves stock untouched, if the guard fails (missing warehouse or insufficient stock) —
 * i.e. if the affected row count isn't exactly 1.
 */
export async function decrementInventory(
  warehouseId: number,
  quantity: number,
  executor: QueryExecutor = getPool()
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }

  const result = await executor.query(
    "UPDATE inventory SET stock = stock - $1 WHERE warehouse_id = $2 AND stock >= $1",
    [quantity, warehouseId]
  );

  if (result.rowCount !== 1) {
    throw new InsufficientStockError(warehouseId, quantity);
  }
}
