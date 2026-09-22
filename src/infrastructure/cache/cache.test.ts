import { expect } from "chai";
import sinon from "sinon";
import { readThrough } from "./cache";
import * as redisClientModule from "./redisClient";

interface FakeRedisClient {
  get: sinon.SinonStub;
  set: sinon.SinonStub;
}

function fakeClient(overrides: Partial<FakeRedisClient> = {}): FakeRedisClient {
  return {
    get: sinon.stub().resolves(null),
    set: sinon.stub().resolves("OK"),
    ...overrides,
  };
}

afterEach(() => {
  sinon.restore();
});

describe("readThrough", () => {
  it("calls load directly, without touching Redis, when no cache client is configured", async () => {
    sinon.stub(redisClientModule, "getRedisClient").returns(undefined);
    const load = sinon.stub().resolves({ id: "item-1" });

    const result = await readThrough("item:item-1", 60, load);

    expect(result).to.deep.equal({ id: "item-1" });
    expect(load.calledOnce).to.equal(true);
  });

  it("returns the cached value on a hit, without calling load", async () => {
    const client = fakeClient({ get: sinon.stub().resolves(JSON.stringify({ id: "item-1" })) });
    sinon.stub(redisClientModule, "getRedisClient").returns(client as never);
    const load = sinon.stub().resolves({ id: "should-not-be-used" });

    const result = await readThrough("item:item-1", 60, load);

    expect(result).to.deep.equal({ id: "item-1" });
    expect(load.called).to.equal(false);
  });

  it("loads and writes back to the cache on a miss", async () => {
    const client = fakeClient();
    sinon.stub(redisClientModule, "getRedisClient").returns(client as never);
    const load = sinon.stub().resolves({ id: "item-1" });

    const result = await readThrough("item:item-1", 60, load);

    expect(result).to.deep.equal({ id: "item-1" });
    expect(load.calledOnce).to.equal(true);
    expect(client.set.calledOnceWith("item:item-1", JSON.stringify({ id: "item-1" }), "EX", 60)).to.equal(true);
  });

  it("does not write undefined values back to the cache", async () => {
    const client = fakeClient();
    sinon.stub(redisClientModule, "getRedisClient").returns(client as never);
    const load = sinon.stub().resolves(undefined);

    const result = await readThrough("item:missing", 60, load);

    expect(result).to.equal(undefined);
    expect(client.set.called).to.equal(false);
  });

  it("falls back to load when reading from Redis fails", async () => {
    const client = fakeClient({ get: sinon.stub().rejects(new Error("connection refused")) });
    sinon.stub(redisClientModule, "getRedisClient").returns(client as never);
    const load = sinon.stub().resolves({ id: "item-1" });

    const result = await readThrough("item:item-1", 60, load);

    expect(result).to.deep.equal({ id: "item-1" });
    expect(load.calledOnce).to.equal(true);
  });

  it("still returns the freshly loaded value when writing back to Redis fails", async () => {
    const client = fakeClient({ set: sinon.stub().rejects(new Error("connection refused")) });
    sinon.stub(redisClientModule, "getRedisClient").returns(client as never);
    const load = sinon.stub().resolves({ id: "item-1" });

    const result = await readThrough("item:item-1", 60, load);

    expect(result).to.deep.equal({ id: "item-1" });
  });
});
