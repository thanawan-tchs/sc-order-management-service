import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "./pool";
import { withTransaction } from "./transaction";
import { getInventory, decrementInventory } from "../../repositories/warehouseRepository";
import { resetTestDb } from "../../../tests/helpers/db";

const LOS_ANGELES_ID = 1;
const LOS_ANGELES_STOCK = 355;

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("withTransaction", () => {
  it("commits every write made with the transaction's client on success", async () => {
    await withTransaction(async (client) => {
      await decrementInventory(LOS_ANGELES_ID, 50, client);
    });

    const inventory = await getInventory(LOS_ANGELES_ID);
    expect(inventory?.stock).toBe(LOS_ANGELES_STOCK - 50);
  });

  it("returns the callback's resolved value", async () => {
    const result = await withTransaction(async () => "ok");
    expect(result).toBe("ok");
  });

  it(
    "rolls back every write made with the transaction's client — including one that " +
      "individually succeeded — when a later step in the same call fails",
    async () => {
      const simulatedFailure = new Error("simulated database failure after a successful inventory update");

      await expect(
        withTransaction(async (client) => {
          // This decrement succeeds inside the transaction...
          await decrementInventory(LOS_ANGELES_ID, 50, client);
          // ...but a later step in the same transaction fails, well after that write.
          throw simulatedFailure;
        })
      ).rejects.toBe(simulatedFailure);

      // The earlier "successful" decrement must not have survived the rollback.
      const inventory = await getInventory(LOS_ANGELES_ID);
      expect(inventory?.stock).toBe(LOS_ANGELES_STOCK);
    }
  );

  it("handles many sequential transactions without leaking a connection (client always released)", async () => {
    for (let i = 0; i < 15; i++) {
      await withTransaction(async () => undefined).catch(() => undefined);
    }

    // If `finally { client.release() }` weren't happening, this would hang waiting for a free
    // connection (the pool's default max size is well under 15) instead of resolving promptly.
    await expect(withTransaction(async () => "still working")).resolves.toBe("still working");
  });

  it("still releases the client back to the pool when the callback throws", async () => {
    for (let i = 0; i < 15; i++) {
      await withTransaction(async () => {
        throw new Error(`boom ${i}`);
      }).catch(() => undefined);
    }

    await expect(withTransaction(async () => "still working")).resolves.toBe("still working");
  });
});

describe("withTransaction against a fresh reader (not the transaction's own client)", () => {
  it("makes committed writes visible via a separate connection", async () => {
    await withTransaction(async (client) => {
      await decrementInventory(LOS_ANGELES_ID, 10, client);
    });

    // A plain pool query — a different connection than the one the transaction used.
    const { rows } = await getPool().query<{ stock: number }>(
      "SELECT stock FROM inventory WHERE warehouse_id = $1",
      [LOS_ANGELES_ID]
    );
    expect(rows[0].stock).toBe(LOS_ANGELES_STOCK - 10);
  });
});
