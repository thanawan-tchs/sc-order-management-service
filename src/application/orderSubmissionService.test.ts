import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { submitOrder } from "./orderSubmissionService";
import {
  IdempotencyKeyReusedError,
  InsufficientStockError,
  OrderSubmissionError,
} from "../domain/errors";
import { closePool, getPool } from "../infrastructure/db/pool";
import { findOrderByIdempotencyKey, getOrderByNumber } from "../repositories/orderRepository";
import { getInventory } from "../repositories/warehouseRepository";
import { resetTestDb } from "../../tests/helpers/db";
import { pointAtDistanceFrom } from "../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;
const SAO_PAULO_ID = 3;
const PARIS_ID = 4;
const WARSAW_ID = 5;
const HONG_KONG_ID = 6;
const ALL_WAREHOUSE_IDS = [
  LOS_ANGELES_ID,
  NEW_YORK_ID,
  SAO_PAULO_ID,
  PARIS_ID,
  WARSAW_ID,
  HONG_KONG_ID,
];
// items is truncated + reseeded fresh by resetTestDb, but its id is a UUID (ticket "use item
// id as uuid format"), generated fresh each time — captured in beforeEach rather than hardcoded.
let itemId: string;

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
  await pool.query("UPDATE inventory SET stock = $1 WHERE warehouse_id = $2 AND item_id = $3", [
    stock,
    id,
    itemId,
  ]);
}

async function zeroOutStock(ids: number[]): Promise<void> {
  const pool = getPool();
  for (const id of ids) {
    await pool.query("UPDATE inventory SET stock = 0 WHERE warehouse_id = $1 AND item_id = $2", [
      id,
      itemId,
    ]);
  }
}

async function countOrders(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    "SELECT COUNT(*)::int AS count FROM orders"
  );
  return Number(rows[0].count);
}

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("submitOrder — successful submission", () => {
  it("fulfills entirely from a single warehouse and decrements its stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const order = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
    });

    expect(order.orderNumber).toMatch(/^ORD-\d{7}$/);
    expect(order.allocations).toEqual([
      expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 20 }),
    ]);
    expect(order.valid).toBe(true);

    const inventory = await getInventory(LOS_ANGELES_ID, itemId);
    expect(inventory?.stock).toBe(80);

    // Actually persisted, not just returned.
    const fetched = await getOrderByNumber(order.orderNumber);
    expect(fetched).toEqual(order);
  });

  it("splits across multiple warehouses and decrements each of their stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 15);
    await repositionWarehouse(NEW_YORK_ID, DESTINATION, 20, 100);

    const order = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
    });

    expect(order.allocations).toHaveLength(2);
    expect(order.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 15 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 5 }),
      ])
    );

    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(0);
    expect((await getInventory(NEW_YORK_ID, itemId))?.stock).toBe(95);
  });
});

describe("submitOrder — invalid orders never touch inventory or create a row", () => {
  it("rejects insufficient stock and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 5);

    const before = await countOrders();

    await expect(
      submitOrder({ itemId: itemId, quantity: 100, shippingAddress: DESTINATION })
    ).rejects.toBeInstanceOf(OrderSubmissionError);

    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(5);
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
      await submitOrder({ itemId: itemId, quantity: 1, shippingAddress: DESTINATION });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OrderSubmissionError);
    expect((caught as OrderSubmissionError).invalidReasons).toEqual([
      "SHIPPING_COST_EXCEEDS_15_PERCENT",
    ]);
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(10);
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
      submitOrder({ itemId: itemId, quantity: 8, shippingAddress: DESTINATION }),
      submitOrder({ itemId: itemId, quantity: 8, shippingAddress: DESTINATION }),
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
        rejected[0].reason instanceof InsufficientStockError ||
        rejected[0].reason instanceof OrderSubmissionError;
      expect(isExpectedErrorType).toBe(true);
    }

    // Only the winner's deduction persisted; only one order row exists.
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(2);
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
        submitOrder({ itemId: itemId, quantity: 13, shippingAddress: destination1 }),
        submitOrder({ itemId: itemId, quantity: 13, shippingAddress: destination2 }),
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
      expect((await getInventory(winnerPrimaryId, itemId))?.stock).toBe(0);
      expect((await getInventory(loserPrimaryId, itemId))?.stock).toBe(10);

      // Only the winner's 3-unit draw from the shared warehouse persisted.
      expect((await getInventory(SAO_PAULO_ID, itemId))?.stock).toBe(2);

      // Exactly one order was created.
      expect(await countOrders()).toBe(before + 1);
    }
  );
});

describe("submitOrder — idempotency (ticket 13)", () => {
  it("returns the same order for the same key submitted twice, without decrementing inventory twice", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const first = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-key-1",
    });
    const second = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-key-1",
    });

    expect(second).toEqual(first);
    expect(await countOrders()).toBe(1);
    // Decremented once, not twice.
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(80);
  });

  it("treats requests without an idempotency key as always distinct", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const first = await submitOrder({
      itemId: itemId,
      quantity: 5,
      shippingAddress: DESTINATION,
    });
    const second = await submitOrder({
      itemId: itemId,
      quantity: 5,
      shippingAddress: DESTINATION,
    });

    expect(second.orderNumber).not.toBe(first.orderNumber);
    expect(await countOrders()).toBe(2);
  });

  it("under a concurrent submission with the same key, exactly one order is created and both callers receive it", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const [a, b] = await Promise.all([
      submitOrder({
        itemId: itemId,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "concurrent-key",
      }),
      submitOrder({
        itemId: itemId,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "concurrent-key",
      }),
    ]);

    expect(a.orderNumber).toBe(b.orderNumber);
    expect(await countOrders()).toBe(1);
    // Decremented exactly once, not once per caller — proof the "loser" of the idempotency-key
    // race never applied its own decrement (or had it rolled back if it got that far).
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(80);
  });

  it("does not consume the idempotency key on a failed submission — a retry with the same key can still succeed", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);

    await expect(
      submitOrder({
        itemId: itemId,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "retry-after-failure",
      })
    ).rejects.toBeInstanceOf(OrderSubmissionError);
    expect(await findOrderByIdempotencyKey("retry-after-failure")).toBeUndefined();

    // Make the order fulfillable and retry with the SAME key — must not be blocked by the
    // earlier failed attempt (ticket 13: "failed transaction does not consume idempotency state").
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);
    const order = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-after-failure",
    });

    expect(order.quantity).toBe(20);
    expect(await countOrders()).toBe(1);
    expect((await findOrderByIdempotencyKey("retry-after-failure"))?.orderNumber).toBe(
      order.orderNumber
    );
  });

  it("fulfills a request for exactly the available stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 8);

    const order = await submitOrder({
      itemId: itemId,
      quantity: 8,
      shippingAddress: DESTINATION,
      idempotencyKey: "exact-stock",
    });

    expect(order.allocations).toEqual([
      expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 8 }),
    ]);
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(0);
  });

  it("different idempotency keys still correctly compete for the same limited stock (one wins, one fails)", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 10);

    const results = await Promise.allSettled([
      submitOrder({
        itemId: itemId,
        quantity: 8,
        shippingAddress: DESTINATION,
        idempotencyKey: "key-a",
      }),
      submitOrder({
        itemId: itemId,
        quantity: 8,
        shippingAddress: DESTINATION,
        idempotencyKey: "key-b",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      const isExpectedErrorType =
        rejected[0].reason instanceof InsufficientStockError ||
        rejected[0].reason instanceof OrderSubmissionError;
      expect(isExpectedErrorType).toBe(true);
    }
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(2);
  });
});

describe("submitOrder — idempotency key reused for a different request (ticket 15)", () => {
  it("rejects a key reused with a different quantity", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-1",
    });

    await expect(
      submitOrder({
        itemId: itemId,
        quantity: 21,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-1",
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    // The original order is untouched, and no second order/decrement happened.
    expect(await countOrders()).toBe(1);
    expect((await getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(80);
  });

  it("rejects a key reused with a different shipping address", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);
    const otherAddress = { latitude: 10, longitude: 10 };

    await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-2",
    });

    await expect(
      submitOrder({
        itemId: itemId,
        quantity: 20,
        shippingAddress: otherAddress,
        idempotencyKey: "reused-key-2",
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    expect(await countOrders()).toBe(1);
  });

  it("rejects a key reused with a different itemId", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);
    const { rows } = await getPool().query<{ id: string }>(
      "INSERT INTO items (name, price_cents, weight_kg) VALUES ($1, $2, $3) RETURNING id",
      ["Second Item", 5000, 0.5]
    );
    const otherItemId = rows[0].id;
    await getPool().query(
      "INSERT INTO inventory (warehouse_id, item_id, stock) VALUES ($1, $2, $3)",
      [LOS_ANGELES_ID, otherItemId, 100]
    );

    await submitOrder({
      itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-item",
    });

    await expect(
      submitOrder({
        itemId: otherItemId,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-item",
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    expect(await countOrders()).toBe(1);
  });

  it("still accepts a genuinely matching retry (same quantity and address) after a mismatch was rejected", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 100);

    const original = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-3",
    });
    await expect(
      submitOrder({
        itemId: itemId,
        quantity: 99,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-3",
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    const matchingRetry = await submitOrder({
      itemId: itemId,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-3",
    });

    expect(matchingRetry).toEqual(original);
    expect(await countOrders()).toBe(1);
  });
});
