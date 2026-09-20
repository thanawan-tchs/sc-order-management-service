import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyKeyConflictError } from "../domain/errors";
import { toMoney } from "../domain/money";
import { Item, OrderQuote } from "../domain/types";
import { closePool } from "../infrastructure/db/pool";
import {
  createOrder,
  findOrderByIdempotencyKey,
  getOrderByNumber,
  recordIdempotencyKey,
} from "./orderRepository";
import { resetTestDb } from "../../tests/helpers/db";

// Seed order is fixed and resetTestDb() restarts identities, so these are reliably stable.
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;

// items is truncated + reseeded fresh by resetTestDb, but its id is a UUID (ticket "use item id
// as uuid format"), generated fresh each time — captured here rather than hardcoded.
let defaultItem: Item;

function buildQuote(overrides: Partial<OrderQuote> = {}): OrderQuote {
  return {
    quantity: 10,
    item: defaultItem,
    shippingAddress: { latitude: 40.7128, longitude: -74.006 },
    subtotalCents: toMoney(150000),
    discountRate: 0,
    discountCents: toMoney(0),
    amountAfterDiscountCents: toMoney(150000),
    totalWeightKg: 3.65,
    shippingCostCents: toMoney(500),
    totalCents: toMoney(150500),
    valid: true,
    invalidReasons: [],
    allocations: [
      { warehouseId: LOS_ANGELES_ID, quantity: 10, distanceKm: 1234.5, shippingCostCents: toMoney(500) },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  const itemId = await resetTestDb();
  defaultItem = { id: itemId, name: "Standard Unit", priceCents: toMoney(15000), weightKg: 0.365 };
});

afterAll(async () => {
  await closePool();
});

describe("createOrder", () => {
  it("persists an order and returns it with a generated, human-readable order number", async () => {
    const quote = buildQuote();

    const order = await createOrder(quote);

    expect(order.orderNumber).toMatch(/^ORD-\d{7}$/);
    expect(order.quantity).toBe(quote.quantity);
    expect(order.item).toEqual(defaultItem);
    expect(order.subtotalCents).toBe(quote.subtotalCents);
    expect(order.discountRate).toBe(quote.discountRate);
    expect(order.discountCents).toBe(quote.discountCents);
    expect(order.amountAfterDiscountCents).toBe(quote.amountAfterDiscountCents);
    expect(order.shippingCostCents).toBe(quote.shippingCostCents);
    expect(order.totalCents).toBe(quote.totalCents);
    expect(order.valid).toBe(true);
    expect(new Date(order.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("persists a multi-warehouse allocation", async () => {
    const quote = buildQuote({
      quantity: 30,
      allocations: [
        { warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100, shippingCostCents: toMoney(730) },
        { warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50, shippingCostCents: toMoney(182) },
      ],
    });

    const order = await createOrder(quote);

    expect(order.allocations).toHaveLength(2);
    expect(order.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50 }),
      ])
    );

    // Confirm it's actually in the database, not just echoed back from the input.
    const fetched = await getOrderByNumber(order.orderNumber);
    expect(fetched?.allocations).toHaveLength(2);
  });

  it("generates unique order numbers under concurrent creation", async () => {
    const attempts = Array.from({ length: 25 }, () => createOrder(buildQuote()));

    const orders = await Promise.all(attempts);

    const orderNumbers = orders.map((order) => order.orderNumber);
    expect(new Set(orderNumbers).size).toBe(orderNumbers.length);
    for (const orderNumber of orderNumbers) {
      expect(orderNumber).toMatch(/^ORD-\d{7}$/);
    }
  });

  it("preserves the exact pricing snapshot, independent of today's pricing rules", async () => {
    // Values today's pricing.ts (25+ -> 5%, 50+ -> 10%, ...) would never produce for this
    // quantity — proving the repository stores exactly what it's given rather than
    // recalculating anything (ticket 10's "Snapshot Principle").
    const quote = buildQuote({
      quantity: 10,
      subtotalCents: toMoney(999999),
      discountRate: 0.37,
      discountCents: toMoney(123456),
      amountAfterDiscountCents: toMoney(876543),
      shippingCostCents: toMoney(4321),
      totalCents: toMoney(880864),
    });

    const order = await createOrder(quote);
    const fetched = await getOrderByNumber(order.orderNumber);

    expect(fetched?.subtotalCents).toBe(999999);
    expect(fetched?.discountRate).toBe(0.37);
    expect(fetched?.discountCents).toBe(123456);
    expect(fetched?.amountAfterDiscountCents).toBe(876543);
    expect(fetched?.shippingCostCents).toBe(4321);
    expect(fetched?.totalCents).toBe(880864);
  });

  it("preserves the item snapshot, independent of the catalog's current values", async () => {
    // A name/price/weight that don't match the live items row — proving createOrder stores
    // exactly the item snapshot it's given, same Snapshot Principle as pricing above.
    const quote = buildQuote({
      item: { id: defaultItem.id, name: "Renamed Product", priceCents: toMoney(99999), weightKg: 1.23 },
    });

    const order = await createOrder(quote);
    const fetched = await getOrderByNumber(order.orderNumber);

    expect(fetched?.item).toEqual({
      id: defaultItem.id,
      name: "Renamed Product",
      priceCents: 99999,
      weightKg: 1.23,
    });
  });
});

describe("getOrderByNumber", () => {
  it("retrieves the persisted snapshot, matching exactly what createOrder returned", async () => {
    const created = await createOrder(buildQuote());

    const fetched = await getOrderByNumber(created.orderNumber);

    expect(fetched).toEqual(created);
  });

  it("returns undefined for an unknown order number", async () => {
    const fetched = await getOrderByNumber("ORD-9999999");
    expect(fetched).toBeUndefined();
  });
});

describe("recordIdempotencyKey / findOrderByIdempotencyKey", () => {
  it("returns undefined for a key that was never claimed", async () => {
    expect(await findOrderByIdempotencyKey("never-used")).toBeUndefined();
  });

  it("finds the order a key was claimed for", async () => {
    const order = await createOrder(buildQuote());
    await recordIdempotencyKey("key-1", order.orderNumber);

    const found = await findOrderByIdempotencyKey("key-1");

    expect(found).toEqual(order);
  });

  it("rejects claiming the same key twice, for different orders, with a typed error", async () => {
    const first = await createOrder(buildQuote());
    const second = await createOrder(buildQuote({ quantity: 20 }));

    await recordIdempotencyKey("dup-key", first.orderNumber);

    await expect(recordIdempotencyKey("dup-key", second.orderNumber)).rejects.toBeInstanceOf(
      IdempotencyKeyConflictError
    );

    // The original claim is untouched.
    expect((await findOrderByIdempotencyKey("dup-key"))?.orderNumber).toBe(first.orderNumber);
  });

  it("allows the same order to be claimed under two different keys", async () => {
    // Not a scenario the application layer produces, but nothing about the schema forbids it —
    // confirms the PRIMARY KEY constraint is on `key` alone, not `(key, order_number)`.
    const order = await createOrder(buildQuote());

    await recordIdempotencyKey("key-a", order.orderNumber);
    await recordIdempotencyKey("key-b", order.orderNumber);

    expect((await findOrderByIdempotencyKey("key-a"))?.orderNumber).toBe(order.orderNumber);
    expect((await findOrderByIdempotencyKey("key-b"))?.orderNumber).toBe(order.orderNumber);
  });
});
