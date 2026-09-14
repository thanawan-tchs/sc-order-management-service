import { describe, expect, it } from "vitest";
import { ITEM_UNIT_PRICE_CENTS } from "../config";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "./pricing";

describe("calculateSubtotal", () => {
  it("multiplies quantity by the unit price ($150 = 15000 cents)", () => {
    expect(calculateSubtotal(1)).toBe(15000);
    expect(calculateSubtotal(100)).toBe(1500000);
  });

  it("is always an integer number of cents", () => {
    for (const quantity of [1, 24, 25, 99, 100, 250, 1000]) {
      expect(Number.isInteger(calculateSubtotal(quantity))).toBe(true);
    }
  });
});

describe("getDiscountRate boundaries", () => {
  // Explicit boundary quantities called out by ticket 04.
  it.each([
    [24, 0],
    [25, 0.05],
    [49, 0.05],
    [50, 0.1],
    [99, 0.1],
    [100, 0.15],
    [249, 0.15],
    [250, 0.2],
  ])("quantity %i -> rate %s", (quantity, expectedRate) => {
    expect(getDiscountRate(quantity)).toBe(expectedRate);
  });

  it("returns 0% below the first tier", () => {
    expect(getDiscountRate(1)).toBe(0);
    expect(getDiscountRate(0)).toBe(0);
  });

  it("returns 20% for any quantity above the top tier", () => {
    expect(getDiscountRate(1000)).toBe(0.2);
    expect(getDiscountRate(10000)).toBe(0.2);
  });
});

describe("calculateDiscount", () => {
  it("applies the rate to the subtotal", () => {
    const subtotal = calculateSubtotal(50); // 50 * 15000 = 750000
    expect(calculateDiscount(subtotal, 0.1)).toBe(75000);
  });

  it("is zero at 0% discount", () => {
    const subtotal = calculateSubtotal(10);
    expect(calculateDiscount(subtotal, 0)).toBe(0);
  });

  it("is always an integer number of cents", () => {
    for (const quantity of [24, 25, 49, 50, 99, 100, 249, 250]) {
      const subtotal = calculateSubtotal(quantity);
      const rate = getDiscountRate(quantity);
      expect(Number.isInteger(calculateDiscount(subtotal, rate))).toBe(true);
    }
  });
});

describe("calculateAmountAfterDiscount", () => {
  it("subtracts discount from subtotal", () => {
    const subtotal = calculateSubtotal(50);
    const discount = calculateDiscount(subtotal, getDiscountRate(50));
    expect(calculateAmountAfterDiscount(subtotal, discount)).toBe(675000);
  });

  it("equals the subtotal when there is no discount", () => {
    const subtotal = calculateSubtotal(5);
    expect(calculateAmountAfterDiscount(subtotal, calculateDiscount(subtotal, 0))).toBe(subtotal);
  });
});

describe("end-to-end pricing at each boundary", () => {
  it.each([24, 25, 49, 50, 99, 100, 249, 250])(
    "quantity %i: subtotal - discount === amountAfterDiscount, all integer cents",
    (quantity) => {
      const subtotal = calculateSubtotal(quantity);
      const rate = getDiscountRate(quantity);
      const discount = calculateDiscount(subtotal, rate);
      const amountAfterDiscount = calculateAmountAfterDiscount(subtotal, discount);

      expect(subtotal).toBe(quantity * ITEM_UNIT_PRICE_CENTS);
      expect(discount).toBe(Math.round(subtotal * rate));
      expect(amountAfterDiscount).toBe(subtotal - discount);
      expect(Number.isInteger(subtotal)).toBe(true);
      expect(Number.isInteger(discount)).toBe(true);
      expect(Number.isInteger(amountAfterDiscount)).toBe(true);
    }
  );
});
