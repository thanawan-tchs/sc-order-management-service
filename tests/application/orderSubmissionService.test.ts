import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { submitOrder } from "../../src/application/orderSubmissionService";
import { InsufficientStockError, OrderSubmissionError } from "../../src/domain/errors";
import { closePool, getPool } from "../../src/infrastructure/db/pool";
import { getOrderByNumber } from "../../src/repositories/orderRepository";
import { getInventory } from "../../src/repositories/warehouseRepository";
import { resetTestDb } from "../helpers/db";
import { pointAtDistanceFrom } from "../helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;
const SAO_PAULO_ID = 3;
const PARIS_ID = 4;
const WARSAW_ID = 5;
const HONG_KONG_ID = 6;
const ALL_WAREHOUSE_IDS = [LOS_ANGELES_ID, NEW_YORK_ID, SAO_PAULO_ID, PARIS_ID, WARSAW_ID, HONG_KONG_ID];

async function repositionWarehouse(
  id: number,
  origin: { latitude: number; longitude: number },
  distanceKm: number,
  stock: number
): Promise<void> {
  const { latitude, longitude } = pointAtDistanceFrom(origin, distanceKm);
  const pool = getPool();
  await pool.query("UPDATE warehouses SET latitude = $1, longitude = $2 WHERE id = $3", [
    latitude,
    longitude,
    id,
  ]);
  await pool.query("UPDATE inventory SET stock = $1 WHERE warehouse_id = $2", [stock, id]);
}

async function zeroOutStock(ids: number[]): Promise<void> {
  const pool = getPool();
  for (const id of ids) {
    await pool.query("UPDATE inventory SET stock = 0 WHERE warehouse_id = $1", [id]);
  }
}

async function countOrders(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>("SELECT COUNT(*)::int AS count FROM orders");
  return Number(rows[0].count);
}

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("submitOrder — successful submission", () => {
  it("fulfills entirely from a single warehouse and decrements its stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const order = await submitOrder({ quantity: 20, shippingAddress: DESTINATION });

    expect(order.orderNumber).toMatch(/^ORD-\d{7}$/);
    expect(order.allocations).toEqual([
      expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 20 }),
    ]);
    expect(order.valid).toBe(true);

    const inventory = await getInventory(LOS_ANGELES_ID);
    expect(inventory?.stock).toBe(80);

    // Actually persisted, not just returned.
    const fetched = await getOrderByNumber(order.orderNumber);
    expect(fetched).toEqual(order);
  });

  it("splits across multiple warehouses and decrements each of their stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 15);
    await repositionWarehouse(NEW_YORK_ID, DESTINATION, 20, 100);

    const order = await submitOrder({ quantity: 20, shippingAddress: DESTINATION });

    expect(order.allocations).toHaveLength(2);
    expect(order.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 15 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 5 }),
      ])
    );

    expect((await getInventory(LOS_ANGELES_ID))?.stock).toBe(0);
    expect((await getInventory(NEW_YORK_ID))?.stock).toBe(95);
  });
});

describe("submitOrder — invalid orders never touch inventory or create a row", () => {
  it("rejects insufficient stock and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 5);

    const before = await countOrders();

    await expect(submitOrder({ quantity: 100, shippingAddress: DESTINATION })).rejects.toBeInstanceOf(
      OrderSubmissionError
    );

    expect((await getInventory(LOS_ANGELES_ID))?.stock).toBe(5);
    expect(await countOrders()).toBe(before);
  });

  it("rejects shipping cost exceeding 15% and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    // qty 1: no discount, amountAfterDiscount = 15000 cents, 15% limit = 2250 cents.
    // round(10000km * 0.365kg * 1c) = 3650 cents, well over the limit.
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10000, 10);

    const before = await countOrders();

    let caught: unknown;
    try {
      await submitOrder({ quantity: 1, shippingAddress: DESTINATION });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OrderSubmissionError);
    expect((caught as OrderSubmissionError).invalidReasons).toEqual(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
    expect((await getInventory(LOS_ANGELES_ID))?.stock).toBe(10);
    expect(await countOrders()).toBe(before);
  });
});

describe("submitOrder — concurrency", () => {
  it("under an inventory conflict, exactly one of two racing submissions succeeds and the other rolls back cleanly", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 10);

    const before = await countOrders();

    // Both requests want 8 of the only 10 available units — only one can win.
    const results = await Promise.allSettled([
      submitOrder({ quantity: 8, shippingAddress: DESTINATION }),
      submitOrder({ quantity: 8, shippingAddress: DESTINATION }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      // Depending on exactly how the two calls interleave, the loser either loses a live
      // row-lock race inside decrementInventory (InsufficientStockError) or, if the winner's
      // whole transaction already committed by the time the loser reads inventory, fails its
      // own pre-write validity check instead (OrderSubmissionError) — both are correct, safe
      // outcomes (no oversell, clean rollback); which one shows up isn't something a
      // real-database integration test can pin down, so both are accepted here. The
      // timing-independent proof of correctness is the final stock/order-count assertions below.
      const isExpectedErrorType =
        rejected[0].reason instanceof InsufficientStockError || rejected[0].reason instanceof OrderSubmissionError;
      expect(isExpectedErrorType).toBe(true);
    }

    // Only the winner's deduction persisted; only one order row exists.
    expect((await getInventory(LOS_ANGELES_ID))?.stock).toBe(2);
    expect(await countOrders()).toBe(before + 1);
  });

  it(
    "rolls back the WHOLE transaction — including an earlier line's already-applied " +
      "decrement — when a later allocation line loses a race for shared stock",
    async () => {
      // Two different destinations, each with its own nearby "primary" warehouse (so the two
      // concurrent orders don't contend for the same primary), plus one shared, distant,
      // stock-constrained warehouse both orders must spill over into.
      const destination1 = { latitude: 0, longitude: 0 };
      const destination2 = { latitude: 0, longitude: 90 };

      await zeroOutStock(ALL_WAREHOUSE_IDS);
      await repositionWarehouse(LOS_ANGELES_ID, destination1, 10, 10); // order1's primary
      await repositionWarehouse(NEW_YORK_ID, destination2, 10, 10); // order2's primary
      await repositionWarehouse(SAO_PAULO_ID, { latitude: 45, longitude: 45 }, 1, 5); // shared overflow

      const before = await countOrders();

      // Each order needs 13: 10 from its own primary (uncontested) + 3 from the shared
      // warehouse. Combined demand on the shared warehouse is 6, but it only has 5 — so one
      // order's second line must fail, well after its first line already "succeeded".
      const results = await Promise.allSettled([
        submitOrder({ quantity: 13, shippingAddress: destination1 }),
        submitOrder({ quantity: 13, shippingAddress: destination2 }),
      ]);

      const fulfilledIndex = results.findIndex((r) => r.status === "fulfilled");
      const rejectedIndex = results.findIndex((r) => r.status === "rejected");
      expect(fulfilledIndex).not.toBe(-1);
      expect(rejectedIndex).not.toBe(-1);

      const rejectedResult = results[rejectedIndex];
      if (rejectedResult.status === "rejected") {
        // As in the simpler conflict test above: depending on exact interleaving, the loser
        // either loses a live row-lock race on the shared warehouse (after its own primary
        // decrement already succeeded — InsufficientStockError) or, if the winner's transaction
        // already committed by the time the loser reads inventory, fails its own pre-write
        // validity check before ever touching its primary warehouse (OrderSubmissionError). The
        // stock assertions below are what actually prove full-transaction rollback either way:
        // the loser's primary warehouse ends at its original 10 regardless of which path was
        // taken (either "decremented then rolled back", or "never decremented at all").
        const isExpectedErrorType =
          rejectedResult.reason instanceof InsufficientStockError ||
          rejectedResult.reason instanceof OrderSubmissionError;
        expect(isExpectedErrorType).toBe(true);
      }

      // The winner's primary warehouse is fully drained; the loser's primary warehouse is back
      // to its original 10 — proving its earlier, individually-successful 10-unit decrement was
      // undone along with the rest of its transaction.
      const winnerPrimaryId = fulfilledIndex === 0 ? LOS_ANGELES_ID : NEW_YORK_ID;
      const loserPrimaryId = fulfilledIndex === 0 ? NEW_YORK_ID : LOS_ANGELES_ID;
      expect((await getInventory(winnerPrimaryId))?.stock).toBe(0);
      expect((await getInventory(loserPrimaryId))?.stock).toBe(10);

      // Only the winner's 3-unit draw from the shared warehouse persisted.
      expect((await getInventory(SAO_PAULO_ID))?.stock).toBe(2);

      // Exactly one order was created.
      expect(await countOrders()).toBe(before + 1);
    }
  );
});
