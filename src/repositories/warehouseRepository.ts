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
