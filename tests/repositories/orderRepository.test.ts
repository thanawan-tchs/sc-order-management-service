import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toMoney } from "../../src/domain/money";
import { OrderQuote } from "../../src/domain/types";
import { closePool } from "../../src/infrastructure/db/pool";
import { createOrder, getOrderByNumber } from "../../src/repositories/orderRepository";
import { resetTestDb } from "../helpers/db";

// Seed order is fixed and resetTestDb() restarts identities, so these are reliably stable.
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;

function buildQuote(overrides: Partial<OrderQuote> = {}): OrderQuote {
  return {
    quantity: 10,
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
  await resetTestDb();
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
