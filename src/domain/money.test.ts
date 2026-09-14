import { describe, expect, it } from "vitest";
import { toMoney, ZERO_MONEY } from "./money";

describe("toMoney", () => {
  it("accepts an integer number of cents", () => {
    expect(toMoney(15000)).toBe(15000);
    expect(toMoney(0)).toBe(0);
    expect(toMoney(-500)).toBe(-500);
  });

  it("throws on a non-integer amount, rather than silently truncating or persisting a fractional cent", () => {
    expect(() => toMoney(150.5)).toThrow("Money must be an integer number of cents, got 150.5");
    expect(() => toMoney(0.01)).toThrow();
    expect(() => toMoney(NaN)).toThrow();
  });
});

describe("ZERO_MONEY", () => {
  it("is exactly zero", () => {
    expect(ZERO_MONEY).toBe(0);
  });
});
