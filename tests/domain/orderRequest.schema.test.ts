import { describe, expect, it } from "vitest";
import { orderRequestSchema } from "../../src/domain/validation/orderRequest.schema";

const validAddress = { latitude: 40.7128, longitude: -74.006 };

function parse(quantity: unknown, shippingAddress: unknown = validAddress) {
  return orderRequestSchema.safeParse({ quantity, shippingAddress });
}

describe("orderRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(parse(50).success).toBe(true);
  });

  describe("quantity", () => {
    it.each([0, -1, -50])("rejects non-positive quantity (%s)", (quantity) => {
      expect(parse(quantity).success).toBe(false);
    });

    it("rejects a decimal quantity", () => {
      expect(parse(12.5).success).toBe(false);
    });

    it("rejects a missing quantity", () => {
      const result = orderRequestSchema.safeParse({ shippingAddress: validAddress });
      expect(result.success).toBe(false);
    });

    it("rejects a non-numeric quantity", () => {
      expect(parse("50").success).toBe(false);
    });

    it("rejects NaN", () => {
      expect(parse(NaN).success).toBe(false);
    });

    it("rejects Infinity", () => {
      expect(parse(Infinity).success).toBe(false);
      expect(parse(-Infinity).success).toBe(false);
    });

    it("accepts the smallest valid quantity", () => {
      expect(parse(1).success).toBe(true);
    });
  });

  describe("shippingAddress", () => {
    it.each([90.0001, 91, -91])("rejects out-of-range latitude (%s)", (latitude) => {
      expect(parse(50, { latitude, longitude: 0 }).success).toBe(false);
    });

    it.each([180.0001, 181, -181])("rejects out-of-range longitude (%s)", (longitude) => {
      expect(parse(50, { latitude: 0, longitude }).success).toBe(false);
    });

    it("rejects NaN coordinates", () => {
      expect(parse(50, { latitude: NaN, longitude: 0 }).success).toBe(false);
      expect(parse(50, { latitude: 0, longitude: NaN }).success).toBe(false);
    });

    it("rejects Infinity coordinates", () => {
      expect(parse(50, { latitude: Infinity, longitude: 0 }).success).toBe(false);
      expect(parse(50, { latitude: 0, longitude: -Infinity }).success).toBe(false);
    });

    it("rejects missing shippingAddress", () => {
      const result = orderRequestSchema.safeParse({ quantity: 50 });
      expect(result.success).toBe(false);
    });

    it("rejects missing latitude/longitude", () => {
      expect(parse(50, { longitude: 0 }).success).toBe(false);
      expect(parse(50, { latitude: 0 }).success).toBe(false);
    });

    it("rejects non-numeric coordinates", () => {
      expect(parse(50, { latitude: "40.7", longitude: -74 }).success).toBe(false);
    });

    it.each([
      { latitude: 90, longitude: 180 },
      { latitude: -90, longitude: -180 },
      { latitude: 0, longitude: 0 },
    ])("accepts boundary coordinates (%j)", (shippingAddress) => {
      expect(parse(50, shippingAddress).success).toBe(true);
    });
  });
});
