import { expect } from "chai";
import sinon from "sinon";
import { toMoney } from "@domain/money";
import * as redisClientModule from "@infrastructure/cache/redisClient";
import { QueryExecutor } from "@infrastructure/db/prismaClient";
import itemRepository from "./itemRepository";

function fakeExecutor(overrides: { findUnique?: sinon.SinonStub; findMany?: sinon.SinonStub; create?: sinon.SinonStub }): QueryExecutor {
  return { item: overrides } as unknown as QueryExecutor;
}

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_RECORD = { id: ITEM_ID, name: "Standard Unit", price: 15000, currency: "USD", weightKg: 0.365 };
const ITEM = { id: ITEM_ID, name: "Standard Unit", price: 15000, currency: "USD", weightKg: 0.365 };

afterEach(() => {
  sinon.restore();
});

describe("getItem", () => {
  it("retrieves an item by id, mapping the Prisma record to the domain Item shape", async () => {
    const findUnique = sinon.stub().resolves(ITEM_RECORD);

    const item = await itemRepository.getItem(ITEM_ID, fakeExecutor({ findUnique }));

    expect(findUnique.calledWith({ where: { id: ITEM_ID } })).to.equal(true);
    expect(item).to.deep.equal(ITEM);
  });

  it("returns undefined when no row matches", async () => {
    const findUnique = sinon.stub().resolves(null);

    expect(await itemRepository.getItem("unknown-id", fakeExecutor({ findUnique }))).to.equal(undefined);
  });

  it("serves a cache hit without querying the database, when a cache client is configured", async () => {
    const cacheGet = sinon.stub().resolves(JSON.stringify(ITEM));
    sinon.stub(redisClientModule, "getRedisClient").returns({ get: cacheGet, set: sinon.stub() } as never);
    const findUnique = sinon.stub();

    const item = await itemRepository.getItem(ITEM_ID, fakeExecutor({ findUnique }));

    expect(item).to.deep.equal(ITEM);
    expect(findUnique.called).to.equal(false);
    expect(cacheGet.calledOnceWith(`item:${ITEM_ID}`)).to.equal(true);
  });

  it("writes through to the cache on a miss, when a cache client is configured", async () => {
    const cacheSet = sinon.stub().resolves("OK");
    sinon.stub(redisClientModule, "getRedisClient").returns({ get: sinon.stub().resolves(null), set: cacheSet } as never);
    const findUnique = sinon.stub().resolves(ITEM_RECORD);

    const item = await itemRepository.getItem(ITEM_ID, fakeExecutor({ findUnique }));

    expect(item).to.deep.equal(ITEM);
    expect(cacheSet.calledOnceWith(`item:${ITEM_ID}`, JSON.stringify(ITEM), "EX", sinon.match.number)).to.equal(true);
  });
});

describe("getAllItems", () => {
  it("retrieves and maps every item row", async () => {
    const findMany = sinon.stub().resolves([ITEM_RECORD]);

    const items = await itemRepository.getAllItems(fakeExecutor({ findMany }));

    expect(findMany.calledWith({ orderBy: { id: "asc" } })).to.equal(true);
    expect(items).to.have.lengthOf(1);
    expect(items[0]).to.deep.equal({ id: ITEM_ID, name: "Standard Unit", price: 15000, currency: "USD", weightKg: 0.365 });
  });
});

describe("createItem", () => {
  it("inserts a new item and returns the row it gets back, mapped to the domain shape", async () => {
    const insertedRecord = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Deluxe Unit",
      price: 25000,
      currency: "USD",
      weightKg: 1.2,
    };
    const create = sinon.stub().resolves(insertedRecord);

    const item = await itemRepository.createItem(
      { name: "Deluxe Unit", price: toMoney(25000), currency: "USD", weightKg: 1.2 },
      fakeExecutor({ create })
    );

    expect(
      create.calledWith({ data: { name: "Deluxe Unit", price: 25000, currency: "USD", weightKg: 1.2 } })
    ).to.equal(true);
    expect(item).to.deep.equal({ id: insertedRecord.id, name: "Deluxe Unit", price: 25000, currency: "USD", weightKg: 1.2 });
  });
});
