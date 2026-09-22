import { config } from "@config";
import exception from "@domain/errors";
import { Inventory, Warehouse } from "@domain/model/warehouse";
import {
  Warehouse as WarehouseRecord,
  Inventory as InventoryRecord,
} from "@generated/prisma/client";
import { QueryExecutor, getPrismaClient } from "@infrastructure/db/prismaClient";
import { readThrough } from "@infrastructure/cache/cache";

function mapWarehouse(record: WarehouseRecord): Warehouse {
  return { id: record.id, name: record.name, latitude: record.latitude, longitude: record.longitude };
}

function mapInventory(record: InventoryRecord): Inventory {
  return { warehouseId: record.warehouseId, itemId: record.itemId, stock: record.stock };
}

export async function getAllWarehouses(executor: QueryExecutor = getPrismaClient()): Promise<Warehouse[]> {
  return readThrough("warehouses:all", config.cacheTtlSeconds, async () => {
    const records = await executor.warehouse.findMany({ orderBy: { id: "asc" } });
    return records.map(mapWarehouse);
  });
}

export async function getWarehouse(
  id: number,
  executor: QueryExecutor = getPrismaClient()
): Promise<Warehouse | undefined> {
  return readThrough(`warehouse:${id}`, config.cacheTtlSeconds, async () => {
    const record = await executor.warehouse.findUnique({ where: { id } });
    return record ? mapWarehouse(record) : undefined;
  });
}

export async function getInventory(
  warehouseId: number,
  itemId: string,
  executor: QueryExecutor = getPrismaClient()
): Promise<Inventory | undefined> {
  const record = await executor.inventory.findUnique({
    where: { warehouseId_itemId: { warehouseId, itemId } },
  });
  return record ? mapInventory(record) : undefined;
}

export async function decrementInventory(
  warehouseId: number,
  itemId: string,
  quantity: number,
  executor: QueryExecutor = getPrismaClient()
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }

  const result = await executor.inventory.updateMany({
    where: { warehouseId, itemId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });

  if (result.count !== 1) {
    throw new exception.InsufficientStockError(warehouseId, quantity);
  }
}

export default { getAllWarehouses, getWarehouse, getInventory, decrementInventory };
