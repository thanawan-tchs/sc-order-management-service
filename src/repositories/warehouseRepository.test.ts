import { expect } from "chai";
import sinon from "sinon";
import { SEED_WAREHOUSES } from "@config";
import { InsufficientStockError } from "@domain/errors";
import { QueryExecutor } from "@infrastructure/db/pool";
import * as warehouseRepository from "./warehouseRepository";

function fakeExecutor(query: sinon.SinonStub): QueryExecutor {
  return { query } as unknown as QueryExecutor;
}

const LOS_ANGELES_ID = 1;
const LOS_ANGELES_STOCK = SEED_WAREHOUSES[0].stock;
const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const NONEXISTENT_ITEM_ID = "00000000-0000-0000-0000-000000000000";

const WAREHOUSE_ROWS = SEED_WAREHOUSES.map((w, index) => ({
  id: index + 1,
  name: w.name,
  latitude: w.latitude,
  longitude: w.longitude,
}));

describe("getAllWarehouses", () => {
  it("retrieves and maps every warehouse row", async () => {
    const query = sinon.stub().resolves({ rows: WAREHOUSE_ROWS, rowCount: WAREHOUSE_ROWS.length });

    const warehouses = await warehouseRepository.getAllWarehouses(fakeExecutor(query));

    expect(query.calledWith("SELECT id, name, latitude, longitude FROM warehouses ORDER BY id")).to.equal(true);
    expect(warehouses).to.have.lengthOf(6);
    expect(warehouses.map((w) => w.name).sort()).to.deep.equal([...SEED_WAREHOUSES.map((w) => w.name)].sort());

    const losAngeles = warehouses.find((w) => w.id === LOS_ANGELES_ID);
    expect(losAngeles).to.deep.include({ name: "Los Angeles", latitude: 33.9425, longitude: -118.408056 });
  });
});

describe("getWarehouse", () => {
  it("retrieves a single warehouse by id", async () => {
    const query = sinon.stub().resolves({ rows: [WAREHOUSE_ROWS[0]], rowCount: 1 });

    const warehouse = await warehouseRepository.getWarehouse(LOS_ANGELES_ID, fakeExecutor(query));

    expect(query.calledWith("SELECT id, name, latitude, longitude FROM warehouses WHERE id = $1", [LOS_ANGELES_ID])).to
      .equal(true);
    expect(warehouse?.name).to.equal("Los Angeles");
  });

  it("returns undefined for an unknown id", async () => {
    const query = sinon.stub().resolves({ rows: [], rowCount: 0 });

    const warehouse = await warehouseRepository.getWarehouse(999, fakeExecutor(query));

    expect(warehouse).to.equal(undefined);
  });
});

describe("getInventory", () => {
  it("returns stock, mapping item_id to the domain field name", async () => {
    const query = sinon
      .stub()
      .resolves({ rows: [{ warehouse_id: LOS_ANGELES_ID, item_id: ITEM_ID, stock: LOS_ANGELES_STOCK }], rowCount: 1 });

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, ITEM_ID, fakeExecutor(query));

    expect(
      query.calledWith("SELECT warehouse_id, item_id, stock FROM inventory WHERE warehouse_id = $1 AND item_id = $2", [
        LOS_ANGELES_ID,
        ITEM_ID,
      ])
    ).to.equal(true);
    expect(inventory).to.deep.equal({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: LOS_ANGELES_STOCK });
  });

  it("returns undefined for a warehouse/item pair with no inventory row", async () => {
    const query = sinon.stub().resolves({ rows: [], rowCount: 0 });

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, NONEXISTENT_ITEM_ID, fakeExecutor(query));

    expect(inventory).to.equal(undefined);
  });
});

describe("decrementInventory", () => {
  it("sends the guarded UPDATE with quantity/warehouseId/itemId, in that parameter order", async () => {
    const query = sinon.stub().resolves({ rowCount: 1 });

    await warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 100, fakeExecutor(query));

    expect(
      query.calledWith(
        "UPDATE inventory SET stock = stock - $1 WHERE warehouse_id = $2 AND item_id = $3 AND stock >= $1",
        [100, LOS_ANGELES_ID, ITEM_ID]
      )
    ).to.equal(true);
  });

  it("throws InsufficientStockError when the guarded UPDATE affects zero rows (insufficient stock)", async () => {
    const query = sinon.stub().resolves({ rowCount: 0 });

    await expect(
      warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, LOS_ANGELES_STOCK + 1, fakeExecutor(query))
    ).to.be.rejectedWith(InsufficientStockError);
  });

  it("throws InsufficientStockError for a nonexistent warehouse or item (same zero-row-affected signal)", async () => {
    const query = sinon.stub().resolves({ rowCount: 0 });

    await expect(warehouseRepository.decrementInventory(999, ITEM_ID, 1, fakeExecutor(query))).to.be.rejectedWith(
      InsufficientStockError
    );
  });

  it("rejects a non-positive or non-integer quantity before ever querying", async () => {
    const query = sinon.stub().resolves({ rowCount: 1 });

    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 0, fakeExecutor(query))).to.be
      .rejected;
    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 1.5, fakeExecutor(query))).to.be
      .rejected;
    expect(query.called).to.equal(false);
  });

  it("never lets concurrent deductions oversell stock", async () => {
    let stock = 10;
    const query = sinon.stub().callsFake(async (_sql: string, params: unknown[]) => {
      const [quantity] = params as [number];
      if (stock >= quantity) {
        stock -= quantity;
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    });
    const executor = fakeExecutor(query);

    const attempts = Array.from({ length: 15 }, () =>
      warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 1, executor)
    );
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded).to.have.lengthOf(10);
    expect(failed).to.have.lengthOf(5);
    for (const failure of failed) {
      if (failure.status === "rejected") {
        expect(failure.reason).to.be.instanceOf(InsufficientStockError);
      }
    }
    expect(stock).to.equal(0);
  });
});
