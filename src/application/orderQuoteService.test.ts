import { describe, expect, it } from "vitest";
import { getOrderQuote, OrderQuoteDependencies } from "./orderQuoteService";
import { ITEM_WEIGHT_KG } from "../config";
import { WarehouseCandidate } from "../domain/allocation";
import { pointAtDistanceFromOrigin } from "../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

function candidateAtDistance(distanceKm: number, warehouseId: number, stock: number): WarehouseCandidate {
  const { latitude, longitude } = pointAtDistanceFromOrigin(distanceKm);
  return { warehouseId, latitude, longitude, stock };
}

/** Injects a fixed, synthetic warehouse snapshot so these are true isolated unit tests — no
 *  database, no HTTP — of the service's orchestration logic (ticket 08 DoD). */
function withCandidates(candidates: WarehouseCandidate[]): OrderQuoteDependencies {
  return { readWarehouseCandidates: async () => candidates };
}

describe("getOrderQuote", () => {
  it("returns a valid quote for a straightforward single-warehouse order", async () => {
    const deps = withCandidates([candidateAtDistance(50, 1, 100)]);

    const quote = await getOrderQuote({ quantity: 10, shippingAddress: DESTINATION }, deps);

    // subtotal = 10 * 15000 = 150000; qty 10 is below the first (25-unit) discount tier.
    expect(quote.quantity).toBe(10);
    expect(quote.subtotalCents).toBe(150000);
    expect(quote.discountRate).toBe(0);
    expect(quote.discountCents).toBe(0);
    expect(quote.amountAfterDiscountCents).toBe(150000);
    expect(quote.totalWeightKg).toBeCloseTo(10 * ITEM_WEIGHT_KG, 10);
    // shipping = round(50km * (10 * 0.365kg) * 1c) = round(182.5) = 183.
    expect(quote.shippingCostCents).toBe(183);
    expect(quote.totalCents).toBe(150000 + 183);
    expect(quote.allocations).toHaveLength(1);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("applies the correct discount rate across tier boundaries", async () => {
    const deps = withCandidates([candidateAtDistance(1, 1, 1000)]);

    const below = await getOrderQuote({ quantity: 24, shippingAddress: DESTINATION }, deps);
    const at25 = await getOrderQuote({ quantity: 25, shippingAddress: DESTINATION }, deps);
    const below250 = await getOrderQuote({ quantity: 249, shippingAddress: DESTINATION }, deps);
    const at250 = await getOrderQuote({ quantity: 250, shippingAddress: DESTINATION }, deps);

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

    const quote = await getOrderQuote({ quantity: 80, shippingAddress: DESTINATION }, deps);

    expect(quote.allocations).toHaveLength(2);
    expect(quote.allocations[0]).toMatchObject({ warehouseId: 1, quantity: 50, shippingCostCents: 1825 });
    expect(quote.allocations[1]).toMatchObject({ warehouseId: 2, quantity: 30, shippingCostCents: 2190 });
    expect(quote.shippingCostCents).toBe(4015);
    // qty 80 -> 10% tier.
    expect(quote.discountRate).toBe(0.1);
    expect(quote.valid).toBe(true);
  });

  it("flags insufficient stock as invalid, while still returning the partial allocation", async () => {
    const deps = withCandidates([candidateAtDistance(10, 1, 10)]);

    const quote = await getOrderQuote({ quantity: 50, shippingAddress: DESTINATION }, deps);

    expect(quote.valid).toBe(false);
    expect(quote.invalidReasons).toEqual(["INSUFFICIENT_STOCK"]);
    expect(quote.allocations).toEqual([expect.objectContaining({ warehouseId: 1, quantity: 10 })]);
    // Pricing still reflects the requested quantity, not the fulfillable amount.
    expect(quote.subtotalCents).toBe(50 * 15000);
  });

  it("flags shipping cost exceeding 15% of the discounted amount as invalid", async () => {
    // qty 1: no discount, amountAfterDiscount = 15000 cents, 15% limit = 2250 cents.
    // A 10,000km shipment of one 0.365kg unit costs round(10000 * 0.365) = 3650 cents.
    const deps = withCandidates([candidateAtDistance(10000, 1, 10)]);

    const quote = await getOrderQuote({ quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).toBe(15000);
    expect(quote.shippingCostCents).toBe(3650);
    expect(quote.valid).toBe(false);
    expect(quote.invalidReasons).toEqual(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
  });

  it("treats shipping cost exactly at 15% as valid (inclusive boundary)", async () => {
    // qty 1: amountAfterDiscount = 15000 cents, 15% limit = 2250 cents exactly.
    // Pick a distance that makes shippingCostCents land on exactly 2250.
    const distanceForExactly2250Cents = 2250 / (1 * ITEM_WEIGHT_KG);
    const deps = withCandidates([candidateAtDistance(distanceForExactly2250Cents, 1, 10)]);

    const quote = await getOrderQuote({ quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).toBe(15000);
    expect(quote.shippingCostCents).toBe(2250);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("treats shipping cost below 15% as valid", async () => {
    const deps = withCandidates([candidateAtDistance(20, 1, 50)]);

    const quote = await getOrderQuote({ quantity: 5, shippingAddress: DESTINATION }, deps);

    // amountAfterDiscount = 75000, 15% limit = 11250; shipping = round(20 * 5*0.365) = 37.
    expect(quote.shippingCostCents).toBe(37);
    expect(quote.shippingCostCents).toBeLessThan(11250);
    expect(quote.valid).toBe(true);
    expect(quote.invalidReasons).toEqual([]);
  });

  it("never creates an order, changes inventory, or reserves stock", async () => {
    const candidates = [candidateAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    const deps = withCandidates(candidates);

    await getOrderQuote({ quantity: 20, shippingAddress: DESTINATION }, deps);

    // The only "side effect" available to this service is reading — assert the stock snapshot
    // it read is untouched, since there is no order/inventory write path to call in the first
    // place (no repository import that mutates state is reachable from getOrderQuote).
    expect(candidates).toEqual(snapshot);
  });
});
