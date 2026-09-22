import { expect } from "chai";
import sinon from "sinon";
import * as poolModule from "./pool";
import { withTransaction } from "./transaction";
import warehouseRepository from "@repositories/warehouseRepository";

const LOS_ANGELES_ID = 1;
const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const STARTING_STOCK = 355;

function makeFakeClient(committed: { stock: number }) {
  let working = { ...committed };

  return {
    query: async (sql: string, params: unknown[] = []) => {
      const text = sql.trim();
      if (text === "BEGIN") {
        working = { ...committed };
        return { rows: [], rowCount: 0 };
      }
      if (text === "COMMIT") {
        committed.stock = working.stock;
        return { rows: [], rowCount: 0 };
      }
      if (text === "ROLLBACK") {
        working = { ...committed };
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith("UPDATE inventory SET stock = stock -")) {
        const [quantity] = params as [number];
        if (working.stock >= quantity) {
          working.stock -= quantity;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith("SELECT warehouse_id, item_id, stock FROM inventory")) {
        return { rows: [{ warehouse_id: LOS_ANGELES_ID, item_id: ITEM_ID, stock: working.stock }], rowCount: 1 };
      }
      throw new Error(`fake client: unhandled query ${text}`);
    },
    release: sinon.stub(),
  };
}

function makeFakePool(committed: { stock: number }, maxConnections: number) {
  let active = 0;
  return {
    query: async (sql: string) => {
      const text = sql.trim();
      if (text.startsWith("SELECT warehouse_id, item_id, stock FROM inventory")) {
        return { rows: [{ warehouse_id: LOS_ANGELES_ID, item_id: ITEM_ID, stock: committed.stock }], rowCount: 1 };
      }
      throw new Error(`fake pool: unhandled query ${text}`);
    },
    connect: async () => {
      if (active >= maxConnections) {
        throw new Error("fake pool exhausted: no available connections");
      }
      active++;
      const client = makeFakeClient(committed);
      const originalRelease = client.release;
      client.release = sinon.stub().callsFake(() => {
        active--;
        return originalRelease();
      });
      return client;
    },
  };
}

describe("withTransaction", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("commits every write made with the transaction's client on success", async () => {
    const committed = { stock: STARTING_STOCK };
    sinon.stub(poolModule, "getPool").returns(makeFakePool(committed, 10) as never);

    await withTransaction(async (client) => {
      await warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 50, client as never);
    });

    expect(committed.stock).to.equal(STARTING_STOCK - 50);
  });

  it("returns the callback's resolved value", async () => {
    sinon.stub(poolModule, "getPool").returns(makeFakePool({ stock: STARTING_STOCK }, 10) as never);

    const result = await withTransaction(async () => "ok");
    expect(result).to.equal("ok");
  });

  it(
    "rolls back every write made with the transaction's client — including one that " +
      "individually succeeded — when a later step in the same call fails",
    async () => {
      const committed = { stock: STARTING_STOCK };
      sinon.stub(poolModule, "getPool").returns(makeFakePool(committed, 10) as never);
      const simulatedFailure = new Error("simulated database failure after a successful inventory update");

      await expect(
        withTransaction(async (client) => {
          await warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 50, client as never);
          throw simulatedFailure;
        })
      ).to.be.rejectedWith(simulatedFailure);

      expect(committed.stock).to.equal(STARTING_STOCK);
    }
  );

  it("handles many sequential transactions without leaking a connection (client always released)", async () => {
    sinon.stub(poolModule, "getPool").returns(makeFakePool({ stock: STARTING_STOCK }, 3) as never);

    for (let i = 0; i < 15; i++) {
      await withTransaction(async () => undefined).catch(() => undefined);
    }

    await expect(withTransaction(async () => "still working")).to.eventually.equal("still working");
  });

  it("still releases the client back to the pool when the callback throws", async () => {
    sinon.stub(poolModule, "getPool").returns(makeFakePool({ stock: STARTING_STOCK }, 3) as never);

    for (let i = 0; i < 15; i++) {
      await withTransaction(async () => {
        throw new Error(`boom ${i}`);
      }).catch(() => undefined);
    }

    await expect(withTransaction(async () => "still working")).to.eventually.equal("still working");
  });
});

describe("withTransaction against a fresh reader (not the transaction's own client)", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("makes committed writes visible via a separate connection", async () => {
    const committed = { stock: STARTING_STOCK };
    sinon.stub(poolModule, "getPool").returns(makeFakePool(committed, 10) as never);

    await withTransaction(async (client) => {
      await warehouseRepository.decrementInventory(LOS_ANGELES_ID, ITEM_ID, 10, client as never);
    });

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, ITEM_ID);
    expect(inventory?.stock).to.equal(STARTING_STOCK - 10);
  });
});
