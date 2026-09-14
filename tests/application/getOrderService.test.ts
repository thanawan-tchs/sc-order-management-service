import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getOrder } from "../../src/application/getOrderService";
import { toMoney } from "../../src/domain/money";
import { OrderQuote } from "../../src/domain/types";
import { closePool } from "../../src/infrastructure/db/pool";
import { createOrder } from "../../src/repositories/orderRepository";
import { resetTestDb } from "../helpers/db";

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

describe("getOrder", () => {
  it("returns the persisted order for an existing order number", async () => {
    const created = await createOrder(buildQuote());

    const found = await getOrder(created.orderNumber);

    expect(found).toEqual(created);
  });

  it("returns undefined for an unknown order number", async () => {
    expect(await getOrder("ORD-9999999")).toBeUndefined();
  });

  it("returns a multi-warehouse order's full allocation set", async () => {
    const created = await createOrder(
      buildQuote({
        quantity: 30,
        allocations: [
          { warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100, shippingCostCents: toMoney(730) },
          { warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50, shippingCostCents: toMoney(182) },
        ],
      })
    );

    const found = await getOrder(created.orderNumber);

    expect(found?.allocations).toHaveLength(2);
    expect(found?.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50 }),
      ])
    );
  });

  it("returns the exact historical snapshot, even for values today's pricing rules would never produce", async () => {
    // Deliberately a discount rate/amounts no current tier in pricing.ts could produce for this
    // quantity — proves this read path never recalculates, only reads what was stored at
    // submission time (ticket 10's Snapshot Principle; ticket 14's "do not recalculate historical
    // pricing, distance, or discount").
    const created = await createOrder(
      buildQuote({
        quantity: 10,
        discountRate: 0.42,
        discountCents: toMoney(63000),
        subtotalCents: toMoney(150000),
        amountAfterDiscountCents: toMoney(87000),
        shippingCostCents: toMoney(999),
        totalCents: toMoney(87999),
      })
    );

    const found = await getOrder(created.orderNumber);

    expect(found?.discountRate).toBe(0.42);
    expect(found?.discountCents).toBe(63000);
    expect(found?.amountAfterDiscountCents).toBe(87000);
    expect(found?.shippingCostCents).toBe(999);
    expect(found?.totalCents).toBe(87999);
  });
});
