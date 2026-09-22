import { expect } from "chai";
import { toMoney } from "./money";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "./pricing";

const UNIT_PRICE_CENTS = toMoney(15000);

describe("calculateSubtotal", () => {
  it("multiplies quantity by the unit price ($150 = 15000 cents)", () => {
    expect(calculateSubtotal(1, UNIT_PRICE_CENTS)).to.equal(15000);
    expect(calculateSubtotal(100, UNIT_PRICE_CENTS)).to.equal(1500000);
  });

  it("is always an integer number of cents", () => {
    for (const quantity of [1, 24, 25, 99, 100, 250, 1000]) {
      expect(Number.isInteger(calculateSubtotal(quantity, UNIT_PRICE_CENTS))).to.equal(true);
    }
  });
});

describe("getDiscountRate boundaries", () => {
  const boundaryCases = [
    [24, 0],
    [25, 0.05],
    [49, 0.05],
    [50, 0.1],
    [99, 0.1],
    [100, 0.15],
    [249, 0.15],
    [250, 0.2],
  ] as const;

  for (const [quantity, expectedRate] of boundaryCases) {
    it(`quantity ${quantity} -> rate ${expectedRate}`, () => {
      expect(getDiscountRate(quantity)).to.equal(expectedRate);
    });
  }

  it("returns 0% below the first tier", () => {
    expect(getDiscountRate(1)).to.equal(0);
    expect(getDiscountRate(0)).to.equal(0);
  });

  it("returns 20% for any quantity above the top tier", () => {
    expect(getDiscountRate(1000)).to.equal(0.2);
    expect(getDiscountRate(10000)).to.equal(0.2);
  });
});

describe("calculateDiscount", () => {
  it("applies the rate to the subtotal", () => {
    const subtotal = calculateSubtotal(50, UNIT_PRICE_CENTS); // 50 * 15000 = 750000
    expect(calculateDiscount(subtotal, 0.1)).to.equal(75000);
  });

  it("is zero at 0% discount", () => {
    const subtotal = calculateSubtotal(10, UNIT_PRICE_CENTS);
    expect(calculateDiscount(subtotal, 0)).to.equal(0);
  });

  it("is always an integer number of cents", () => {
    for (const quantity of [24, 25, 49, 50, 99, 100, 249, 250]) {
      const subtotal = calculateSubtotal(quantity, UNIT_PRICE_CENTS);
      const rate = getDiscountRate(quantity);
      expect(Number.isInteger(calculateDiscount(subtotal, rate))).to.equal(true);
    }
  });
});

describe("calculateAmountAfterDiscount", () => {
  it("subtracts discount from subtotal", () => {
    const subtotal = calculateSubtotal(50, UNIT_PRICE_CENTS);
    const discount = calculateDiscount(subtotal, getDiscountRate(50));
    expect(calculateAmountAfterDiscount(subtotal, discount)).to.equal(675000);
  });

  it("equals the subtotal when there is no discount", () => {
    const subtotal = calculateSubtotal(5, UNIT_PRICE_CENTS);
    expect(calculateAmountAfterDiscount(subtotal, calculateDiscount(subtotal, 0))).to.equal(subtotal);
  });
});

describe("end-to-end pricing at each boundary", () => {
  const quantities = [24, 25, 49, 50, 99, 100, 249, 250];

  for (const quantity of quantities) {
    it(`quantity ${quantity}: subtotal - discount === amountAfterDiscount, all integer cents`, () => {
      const subtotal = calculateSubtotal(quantity, UNIT_PRICE_CENTS);
      const rate = getDiscountRate(quantity);
      const discount = calculateDiscount(subtotal, rate);
      const amountAfterDiscount = calculateAmountAfterDiscount(subtotal, discount);

      expect(subtotal).to.equal(quantity * UNIT_PRICE_CENTS);
      expect(discount).to.equal(Math.round(subtotal * rate));
      expect(amountAfterDiscount).to.equal(subtotal - discount);
      expect(Number.isInteger(subtotal)).to.equal(true);
      expect(Number.isInteger(discount)).to.equal(true);
      expect(Number.isInteger(amountAfterDiscount)).to.equal(true);
    });
  }
});
