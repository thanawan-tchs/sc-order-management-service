import { expect } from "chai";
import { toMoney, ZERO_MONEY } from "./money";

describe("toMoney", () => {
  it("accepts an integer number of cents", () => {
    expect(toMoney(15000)).to.equal(15000);
    expect(toMoney(0)).to.equal(0);
    expect(toMoney(-500)).to.equal(-500);
  });

  it("throws on a non-integer amount, rather than silently truncating or persisting a fractional cent", () => {
    expect(() => toMoney(150.5)).to.throw("Money must be an integer number of cents, got 150.5");
    expect(() => toMoney(0.01)).to.throw();
    expect(() => toMoney(NaN)).to.throw();
  });
});

describe("ZERO_MONEY", () => {
  it("is exactly zero", () => {
    expect(ZERO_MONEY).to.equal(0);
  });
});
