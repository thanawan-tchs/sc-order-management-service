import { expect } from "chai";
import { toMoney } from "./money";
import { isShippingCostWithinLimit, MAX_SHIPPING_RATIO } from "./validity";

describe("isShippingCostWithinLimit", () => {
  it("documents the 15% figure consistently with the actual limit", () => {
    expect(MAX_SHIPPING_RATIO).to.equal(0.15);
  });

  it("is within limit when shipping is well below 15%", () => {
    expect(isShippingCostWithinLimit(toMoney(100), toMoney(10000))).to.equal(true);
  });

  it("is over limit when shipping is well above 15%", () => {
    expect(isShippingCostWithinLimit(toMoney(5000), toMoney(10000))).to.equal(false);
  });

  it("is within limit at zero shipping cost, for any positive amount", () => {
    expect(isShippingCostWithinLimit(toMoney(0), toMoney(1))).to.equal(true);
    expect(isShippingCostWithinLimit(toMoney(0), toMoney(1_000_000))).to.equal(true);
  });

  describe("the exact 15% boundary (inclusive)", () => {
    const amountAfterDiscount = toMoney(10000);
    const exactlyFifteenPercent = toMoney(1500);

    it("is within limit at exactly 15%", () => {
      expect(isShippingCostWithinLimit(exactlyFifteenPercent, amountAfterDiscount)).to.equal(true);
    });

    it("is within limit at one cent under 15%", () => {
      expect(isShippingCostWithinLimit(toMoney(1499), amountAfterDiscount)).to.equal(true);
    });

    it("is over limit at one cent over 15%", () => {
      expect(isShippingCostWithinLimit(toMoney(1501), amountAfterDiscount)).to.equal(false);
    });
  });

  it("holds exactly at 15% across a range of amounts, not just one convenient fixture", () => {
    for (const amountAfterDiscount of [20, 200, 2000, 20000, 200000, 2000000]) {
      const exactlyFifteenPercent = Math.round(amountAfterDiscount * 0.15);
      expect(
        isShippingCostWithinLimit(toMoney(exactlyFifteenPercent), toMoney(amountAfterDiscount))
      ).to.equal(true);
      expect(
        isShippingCostWithinLimit(toMoney(exactlyFifteenPercent + 1), toMoney(amountAfterDiscount))
      ).to.equal(false);
    }
  });

  it("is not fooled by 0.15's binary floating-point representation at the boundary", () => {
    const amountAfterDiscount = toMoney(150000);
    const exactlyFifteenPercent = toMoney(22500);

    expect(isShippingCostWithinLimit(exactlyFifteenPercent, amountAfterDiscount)).to.equal(true);
    expect(isShippingCostWithinLimit(toMoney(22501), amountAfterDiscount)).to.equal(false);
  });
});
