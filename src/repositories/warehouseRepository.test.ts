import { expect } from "chai";
import sinon from "sinon";
import { SEED_WAREHOUSES } from "@config";
import exception from "@domain/errors";
import * as redisClientModule from "@infrastructure/cache/redisClient";
import { QueryExecutor } from "@infrastructure/db/prismaClient";
import warehouseRepository from "./warehouseRepository";

function fakeExecutor(overrides: {
  findMany?: sinon.SinonStub;
  findUnique?: sinon.SinonStub;
  inventoryFindUnique?: sinon.SinonStub;
  updateMany?: sinon.SinonStub;
}): QueryExecutor {
  return {
    warehouse: { findMany: overrides.findMany, findUnique: overrides.findUnique },
    inventory: { findUnique: overrides.inventoryFindUnique, updateMany: overrides.updateMany },
  } as unknown as QueryExecutor;
}

afterEach(() => {
  sinon.restore();
});

const LOS_ANGELES_ID = 1;
const LOS_ANGELES_STOCK = SEED_WAREHOUSES[0].stock;
const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const NONEXISTENT_ITEM_ID = "00000000-0000-0000-0000-000000000000";

const WAREHOUSE_RECORDS = SEED_WAREHOUSES.map((w, index) => ({
  id: index + 1,
  name: w.name,
  latitude: w.latitude,
  longitude: w.longitude,
}));

describe("getAllWarehouses", () => {
  it("retrieves and maps every warehouse row", async () => {
    const findMany = sinon.stub().resolves(WAREHOUSE_RECORDS);

    const warehouses = await warehouseRepository.getAllWarehouses(fakeExecutor({ findMany }));

    expect(findMany.calledWith({ orderBy: { id: "asc" } })).to.equal(true);
    expect(warehouses).to.have.lengthOf(6);
    expect(warehouses.map((w) => w.name).sort()).to.deep.equal([...SEED_WAREHOUSES.map((w) => w.name)].sort());

    const losAngeles = warehouses.find((w) => w.id === LOS_ANGELES_ID);
    expect(losAngeles).to.deep.include({ name: "Los Angeles", latitude: 33.9425, longitude: -118.408056 });
  });

  it("serves a cache hit without querying the database, when a cache client is configured", async () => {
    const cached = WAREHOUSE_RECORDS.map((record) => ({ ...record }));
    const cacheGet = sinon.stub().resolves(JSON.stringify(cached));
    sinon.stub(redisClientModule, "getRedisClient").returns({ get: cacheGet, set: sinon.stub() } as never);
    const findMany = sinon.stub();

    const warehouses = await warehouseRepository.getAllWarehouses(fakeExecutor({ findMany }));

    expect(warehouses).to.deep.equal(cached);
    expect(findMany.called).to.equal(false);
    expect(cacheGet.calledOnceWith("warehouses:all")).to.equal(true);
  });
});

describe("getWarehouse", () => {
  it("retrieves a single warehouse by id", async () => {
    const findUnique = sinon.stub().resolves(WAREHOUSE_RECORDS[0]);

    const warehouse = await warehouseRepository.getWarehouse(LOS_ANGELES_ID, fakeExecutor({ findUnique }));

    expect(findUnique.calledWith({ where: { id: LOS_ANGELES_ID } })).to.equal(true);
    expect(warehouse?.name).to.equal("Los Angeles");
  });

  it("returns undefined for an unknown id", async () => {
    const findUnique = sinon.stub().resolves(null);

    const warehouse = await warehouseRepository.getWarehouse(999, fakeExecutor({ findUnique }));

    expect(warehouse).to.equal(undefined);
  });

  it("writes through to the cache on a miss, when a cache client is configured", async () => {
    const cacheSet = sinon.stub().resolves("OK");
    sinon.stub(redisClientModule, "getRedisClient").returns({ get: sinon.stub().resolves(null), set: cacheSet } as never);
    const findUnique = sinon.stub().resolves(WAREHOUSE_RECORDS[0]);

    const warehouse = await warehouseRepository.getWarehouse(LOS_ANGELES_ID, fakeExecutor({ findUnique }));

    expect(warehouse?.name).to.equal("Los Angeles");
    expect(
      cacheSet.calledOnceWith(`warehouse:${LOS_ANGELES_ID}`, JSON.stringify(warehouse), "EX", sinon.match.number)
    ).to.equal(true);
  });
});

describe("getInventory", () => {
  it("returns stock, mapping the compound key to the domain field names", async () => {
    const inventoryFindUnique = sinon
      .stub()
      .resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: LOS_ANGELES_STOCK });

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, ITEM_ID, fakeExecutor({ inventoryFindUnique }));

    expect(
      inventoryFindUnique.calledWith({ where: { warehouseId_itemId: { warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID } } })
    ).to.equal(true);
    expect(inventory).to.deep.equal({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: LOS_ANGELES_STOCK });
  });

  it("returns undefined for a warehouse/item pair with no inventory row", async () => {
    const inventoryFindUnique = sinon.stub().resolves(null);

    const inventory = await warehouseRepository.getInventory(
      LOS_ANGELES_ID,
      NONEXISTENT_ITEM_ID,
      fakeExecutor({ inventoryFindUnique })
    );

    expect(inventory).to.equal(undefined);
  });
});

describe("decrementInventory", () => {
  it("sends the guarded conditional update with warehouseId/itemId/stock >= quantity", async () => {
    const updateMany = sinon.stub().resolves({ count: 1 });

    await warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 100, fakeExecutor({ updateMany }));

    expect(
      updateMany.calledWith({
        where: { warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: { gte: 100 } },
        data: { stock: { decrement: 100 } },
      })
    ).to.equal(true);
  });

  it("throws InsufficientStockError when the guarded update affects zero rows (insufficient stock)", async () => {
    const updateMany = sinon.stub().resolves({ count: 0 });

    await expect(
      warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, LOS_ANGELES_STOCK + 1, fakeExecutor({ updateMany }))
    ).to.be.rejectedWith(exception.InsufficientStockError);
  });

  it("throws InsufficientStockError for a nonexistent warehouse or item (same zero-row-affected signal)", async () => {
    const updateMany = sinon.stub().resolves({ count: 0 });

    await expect(
      warehouseRepository.decrementInventory(999, ITEM_ID, 1, fakeExecutor({ updateMany }))
    ).to.be.rejectedWith(exception.InsufficientStockError);
  });

  it("rejects a non-positive or non-integer quantity before ever querying", async () => {
    const updateMany = sinon.stub().resolves({ count: 1 });

    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 0, fakeExecutor({ updateMany }))).to
      .be.rejected;
    await expect(warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 1.5, fakeExecutor({ updateMany })))
      .to.be.rejected;
    expect(updateMany.called).to.equal(false);
  });

  it("never lets concurrent deductions oversell stock", async () => {
    let stock = 10;
    const updateMany = sinon.stub().callsFake(async ({ where }: { where: { stock: { gte: number } } }) => {
      const quantity = where.stock.gte;
      if (stock >= quantity) {
        stock -= quantity;
        return { count: 1 };
      }
      return { count: 0 };
    });
    const executor = fakeExecutor({ updateMany });

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
        expect(failure.reason).to.be.instanceOf(exception.InsufficientStockError);
      }
    }
    expect(stock).to.equal(0);
  });
});
