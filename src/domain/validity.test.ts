import { describe, expect, it } from "vitest";
import { toMoney } from "./money";
import { isShippingCostWithinLimit, MAX_SHIPPING_RATIO } from "./validity";

describe("isShippingCostWithinLimit", () => {
  it("documents the 15% figure consistently with the actual limit", () => {
    expect(MAX_SHIPPING_RATIO).toBe(0.15);
  });

  it("is within limit when shipping is well below 15%", () => {
    expect(isShippingCostWithinLimit(toMoney(100), toMoney(10000))).toBe(true);
  });

  it("is over limit when shipping is well above 15%", () => {
    expect(isShippingCostWithinLimit(toMoney(5000), toMoney(10000))).toBe(false);
  });

  it("is within limit at zero shipping cost, for any positive amount", () => {
    expect(isShippingCostWithinLimit(toMoney(0), toMoney(1))).toBe(true);
    expect(isShippingCostWithinLimit(toMoney(0), toMoney(1_000_000))).toBe(true);
  });

  describe("the exact 15% boundary (inclusive)", () => {
    const amountAfterDiscountCents = toMoney(10000);
    const exactlyFifteenPercent = toMoney(1500);

    it("is within limit at exactly 15%", () => {
      expect(isShippingCostWithinLimit(exactlyFifteenPercent, amountAfterDiscountCents)).toBe(true);
    });

    it("is within limit at one cent under 15%", () => {
      expect(isShippingCostWithinLimit(toMoney(1499), amountAfterDiscountCents)).toBe(true);
    });

    it("is over limit at one cent over 15%", () => {
      expect(isShippingCostWithinLimit(toMoney(1501), amountAfterDiscountCents)).toBe(false);
    });
  });

  it("holds exactly at 15% across a range of amounts, not just one convenient fixture", () => {
    for (const amountAfterDiscountCents of [20, 200, 2000, 20000, 200000, 2000000]) {
      const exactlyFifteenPercent = Math.round(amountAfterDiscountCents * 0.15);
      expect(
        isShippingCostWithinLimit(toMoney(exactlyFifteenPercent), toMoney(amountAfterDiscountCents))
      ).toBe(true);
      expect(
        isShippingCostWithinLimit(toMoney(exactlyFifteenPercent + 1), toMoney(amountAfterDiscountCents))
      ).toBe(false);
    }
  });

  it("is not fooled by 0.15's binary floating-point representation at the boundary", () => {
    const amountAfterDiscountCents = toMoney(150000);
    const exactlyFifteenPercent = toMoney(22500);

    expect(isShippingCostWithinLimit(exactlyFifteenPercent, amountAfterDiscountCents)).toBe(true);
    expect(isShippingCostWithinLimit(toMoney(22501), amountAfterDiscountCents)).toBe(false);
  });
});
