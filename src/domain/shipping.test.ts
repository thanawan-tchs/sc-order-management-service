import { describe, expect, it } from "vitest";
import { SHIPPING_RATE_CENTS_PER_KG_KM } from "../config";
import { calculateShippingCost, sumShippingCosts } from "./shipping";

const UNIT_WEIGHT_KG = 0.365;

describe("calculateShippingCost", () => {
  it("is zero at zero distance, regardless of quantity", () => {
    expect(calculateShippingCost(0, 1, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM)).toBe(0);
    expect(calculateShippingCost(0, 10000, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM)).toBe(0);
  });

  it("computes the cost for a single device", () => {
    expect(calculateShippingCost(1000, 1, 0.365, 1)).toBe(365);
  });

  it("scales linearly with a large quantity", () => {
    expect(calculateShippingCost(500, 10000, 0.365, 1)).toBe(1_825_000);
  });

  it("handles the real business constants for a realistic order", () => {
    const cost = calculateShippingCost(1000, 50, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM);
    expect(cost).toBe(18250);
  });

  it("is always an integer number of cents (no floating-point money)", () => {
    const cost = calculateShippingCost(333, 1, 0.365, 1);
    expect(Number.isInteger(cost)).toBe(true);
  });

  describe("monetary rounding policy", () => {
    it("rounds a fractional cent above the midpoint up", () => {
      expect(calculateShippingCost(333, 1, 0.365, 1)).toBe(122);
    });

    it("rounds a fractional cent below the midpoint down", () => {
      expect(calculateShippingCost(1, 1, 0.366, 1)).toBe(0);
      expect(calculateShippingCost(1, 1, 2.4, 1)).toBe(2);
    });

    it("rounds an exact half cent consistently (round-half-up)", () => {
      expect(calculateShippingCost(1, 1, 2.5, 1)).toBe(3);
    });
  });
});

describe("sumShippingCosts", () => {
  it("sums a single-warehouse allocation to itself", () => {
    const cost = calculateShippingCost(1000, 50, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM);
    expect(sumShippingCosts([cost])).toBe(cost);
  });

  it("sums multiple warehouse allocations into one order total", () => {
    const fromWarehouseA = calculateShippingCost(500, 20, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM); // 3650
    const fromWarehouseB = calculateShippingCost(1200, 15, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM); // 6570
    const fromWarehouseC = calculateShippingCost(80, 15, UNIT_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM); // 438

    const total = sumShippingCosts([fromWarehouseA, fromWarehouseB, fromWarehouseC]);

    expect(total).toBe(fromWarehouseA + fromWarehouseB + fromWarehouseC);
    expect(total).toBe(10658);
  });

  it("returns zero for no allocations", () => {
    expect(sumShippingCosts([])).toBe(0);
  });

  it("is always an integer, even when summing many rounded lines", () => {
    const costs = [333, 1, 2, 3, 4].map((distance) =>
      calculateShippingCost(distance, 7, 0.365, 1)
    );
    expect(Number.isInteger(sumShippingCosts(costs))).toBe(true);
  });
});
