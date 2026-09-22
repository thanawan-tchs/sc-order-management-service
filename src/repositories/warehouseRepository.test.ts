import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SEED_WAREHOUSES } from "../config";
import { InsufficientStockError } from "../domain/errors";
import { closePool, getPool } from "../infrastructure/db/pool";
import * as warehouseRepository from "./warehouseRepository";
import { resetTestDb } from "../../tests/helpers/db";

const LOS_ANGELES_ID = 1;
const LOS_ANGELES_STOCK = SEED_WAREHOUSES[0].stock;
const NONEXISTENT_ITEM_ID = "00000000-0000-0000-0000-000000000000";

let itemId: string;

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("getAllWarehouses", () => {
  it("retrieves all six seeded warehouses", async () => {
    const warehouses = await warehouseRepository.getAllWarehouses();

    expect(warehouses).toHaveLength(6);
    expect(warehouses.map((w) => w.name).sort()).toEqual(
      [...SEED_WAREHOUSES.map((w) => w.name)].sort()
    );

    const losAngeles = warehouses.find((w) => w.id === LOS_ANGELES_ID);
    expect(losAngeles).toMatchObject({
      name: "Los Angeles",
      latitude: 33.9425,
      longitude: -118.408056,
    });
  });
});

describe("getWarehouse", () => {
  it("retrieves a single warehouse by id", async () => {
    const warehouse = await warehouseRepository.getWarehouse(LOS_ANGELES_ID);
    expect(warehouse?.name).toBe("Los Angeles");
  });

  it("returns undefined for an unknown id", async () => {
    const warehouse = await warehouseRepository.getWarehouse(999);
    expect(warehouse).toBeUndefined();
  });
});

describe("getInventory", () => {
  it("returns stock matching the seed data", async () => {
    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, itemId);
    expect(inventory).toMatchObject({ warehouseId: LOS_ANGELES_ID, itemId, stock: LOS_ANGELES_STOCK });
  });

  it("returns undefined for a warehouse with no inventory row", async () => {
    const inventory = await warehouseRepository.getInventory(999, itemId);
    expect(inventory).toBeUndefined();
  });

  it("returns undefined for a warehouse/item pair with no inventory row", async () => {
    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, NONEXISTENT_ITEM_ID);
    expect(inventory).toBeUndefined();
  });
});

describe("decrementInventory", () => {
  it("deducts a valid quantity", async () => {
    await warehouseRepository.decrementInventory(LOS_ANGELES_ID, itemId, 100);

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, itemId);
    expect(inventory?.stock).toBe(LOS_ANGELES_STOCK - 100);
  });

  it("rejects a deduction larger than available stock, leaving stock unchanged", async () => {
    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, itemId, LOS_ANGELES_STOCK + 1)).rejects.toBeInstanceOf(
      InsufficientStockError
    );

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, itemId);
    expect(inventory?.stock).toBe(LOS_ANGELES_STOCK);
  });

  it("rejects deducting from a nonexistent warehouse", async () => {
    await expect(warehouseRepository.decrementInventory(999, itemId, 1)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("rejects deducting a nonexistent item at a real warehouse", async () => {
    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, NONEXISTENT_ITEM_ID, 1)).rejects.toBeInstanceOf(
      InsufficientStockError
    );
  });

  it("never lets concurrent deductions oversell stock", async () => {
    await getPool().query("UPDATE inventory SET stock = 10 WHERE warehouse_id = $1 AND item_id = $2", [
      LOS_ANGELES_ID,
      itemId,
    ]);

    const attempts = Array.from({ length: 15 }, () => warehouseRepository.decrementInventory(LOS_ANGELES_ID, itemId, 1));
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded).toHaveLength(10);
    expect(failed).toHaveLength(5);
    for (const failure of failed) {
      if (failure.status === "rejected") {
        expect(failure.reason).toBeInstanceOf(InsufficientStockError);
      }
    }

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, itemId);
    expect(inventory?.stock).toBe(0);
  });
});
