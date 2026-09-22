import { describe, expect, it } from "vitest";
import { getOrderQuote, OrderQuoteDependencies } from "./orderQuoteService";
import { WarehouseCandidate } from "../domain/allocation";
import { ItemNotFoundError } from "../domain/errors";
import { toMoney } from "../domain/money";
import { Item } from "../domain/types";
import { pointAtDistanceFromOrigin } from "../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

const UNIT_WEIGHT_KG = 0.365;
const TEST_ITEM_ID = "test-item-id";
const TEST_ITEM: Item = { id: TEST_ITEM_ID, name: "Standard Unit", priceCents: toMoney(15000), weightKg: UNIT_WEIGHT_KG };

function candidateAtDistance(distanceKm: number, warehouseId: number, stock: number): WarehouseCandidate {
  const { latitude, longitude } = pointAtDistanceFromOrigin(distanceKm);
  return { warehouseId, latitude, longitude, stock };
}

function withCandidates(candidates: WarehouseCandidate[], item: Item = TEST_ITEM): OrderQuoteDependencies {
  return {
    readWarehouseCandidates: async () => candidates,
    getItem: async () => item,
  };
}

describe("getOrderQuote", () => {
  it("returns a valid quote for a straightforward single-warehouse order", async () => {
    const deps = withCandidates([candidateAtDistance(50, 1, 100)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 10, shippingAddress: DESTINATION }, deps);

    expect(quote.quantity).toBe(10);
    expect(quote.item).toEqual(TEST_ITEM);
    expect(quote.subtotalCents).toBe(150000);
    expect(quote.discountRate).toBe(0);
    expect(quote.discountCents).toBe(0);
    expect(quote.amountAfterDiscountCents).toBe(150000);
    expect(quote.totalWeightKg).toBeCloseTo(10 * UNIT_WEIGHT_KG, 10);
    expect(quote.shippingCostCents).toBe(183);
    expect(quote.totalCents).toBe(150000 + 183);
    expect(quote.allocations).toHaveLength(1);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("throws ItemNotFoundError for an unknown itemId, without reading inventory", async () => {
    let readCandidatesCalled = false;
    const deps: OrderQuoteDependencies = {
      readWarehouseCandidates: async () => {
        readCandidatesCalled = true;
        return [];
      },
      getItem: async () => undefined,
    };

    await expect(
      getOrderQuote({ itemId: "unknown-item-id", quantity: 10, shippingAddress: DESTINATION }, deps)
    ).rejects.toBeInstanceOf(ItemNotFoundError);
    expect(readCandidatesCalled).toBe(false);
  });

  it("applies the correct discount rate across tier boundaries", async () => {
    const deps = withCandidates([candidateAtDistance(1, 1, 1000)]);

    const below = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 24, shippingAddress: DESTINATION }, deps);
    const at25 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 25, shippingAddress: DESTINATION }, deps);
    const below250 = await getOrderQuote(
      { itemId: TEST_ITEM_ID, quantity: 249, shippingAddress: DESTINATION },
      deps
    );
    const at250 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 250, shippingAddress: DESTINATION }, deps);

    expect(below.discountRate).toBe(0);
    expect(below.discountCents).toBe(0);

    expect(at25.discountRate).toBe(0.05);
    expect(at25.subtotalCents).toBe(375000);
    expect(at25.discountCents).toBe(18750);
    expect(at25.amountAfterDiscountCents).toBe(356250);

    expect(below250.discountRate).toBe(0.15);

    expect(at250.discountRate).toBe(0.2);
    expect(at250.subtotalCents).toBe(3750000);
    expect(at250.discountCents).toBe(750000);
    expect(at250.amountAfterDiscountCents).toBe(3000000);

    for (const quote of [below, at25, below250, at250]) {
      expect(quote.valid).toBe(true);
    }
  });

  it("splits a multi-warehouse order across the cheapest warehouses first", async () => {
    const warehouseA = candidateAtDistance(100, 1, 50);
    const warehouseB = candidateAtDistance(200, 2, 50);
    const deps = withCandidates([warehouseB, warehouseA]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 80, shippingAddress: DESTINATION }, deps);

    expect(quote.allocations).toHaveLength(2);
    expect(quote.allocations[0]).toMatchObject({ warehouseId: 1, quantity: 50, shippingCostCents: 1825 });
    expect(quote.allocations[1]).toMatchObject({ warehouseId: 2, quantity: 30, shippingCostCents: 2190 });
    expect(quote.shippingCostCents).toBe(4015);
    expect(quote.discountRate).toBe(0.1);
    expect(quote.valid).toBe(true);
  });

  it("flags insufficient stock as invalid, while still returning the partial allocation", async () => {
    const deps = withCandidates([candidateAtDistance(10, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 50, shippingAddress: DESTINATION }, deps);

    expect(quote.valid).toBe(false);
    expect(quote.invalidReasons).toEqual(["INSUFFICIENT_STOCK"]);
    expect(quote.allocations).toEqual([expect.objectContaining({ warehouseId: 1, quantity: 10 })]);
    expect(quote.subtotalCents).toBe(50 * 15000);
  });

  it("flags shipping cost exceeding 15% of the discounted amount as invalid", async () => {
    const deps = withCandidates([candidateAtDistance(10000, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).toBe(15000);
    expect(quote.shippingCostCents).toBe(3650);
    expect(quote.valid).toBe(false);
    expect(quote.invalidReasons).toEqual(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
  });

  it("treats shipping cost exactly at 15% as valid (inclusive boundary)", async () => {
    const distanceForExactly2250Cents = 2250 / (1 * UNIT_WEIGHT_KG);
    const deps = withCandidates([candidateAtDistance(distanceForExactly2250Cents, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).toBe(15000);
    expect(quote.shippingCostCents).toBe(2250);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("treats shipping cost below 15% as valid", async () => {
    const deps = withCandidates([candidateAtDistance(20, 1, 50)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 5, shippingAddress: DESTINATION }, deps);

    expect(quote.shippingCostCents).toBe(37);
    expect(quote.shippingCostCents).toBeLessThan(11250);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("never creates an order, changes inventory, or reserves stock", async () => {
    const candidates = [candidateAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    const deps = withCandidates(candidates);

    await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 20, shippingAddress: DESTINATION }, deps);

    expect(candidates).toEqual(snapshot);
  });
});
