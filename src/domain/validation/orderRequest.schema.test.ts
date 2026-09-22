import { expect } from "chai";
import { orderRequestSchema } from "./orderRequest.schema";

const validAddress = { latitude: 40.7128, longitude: -74.006 };
const VALID_ITEM_ID = "11111111-1111-1111-1111-111111111111";

function parse(quantity: unknown, shippingAddress: unknown = validAddress, itemId: unknown = VALID_ITEM_ID) {
  return orderRequestSchema.safeParse({ itemId, quantity, shippingAddress });
}

describe("orderRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(parse(50).success).to.equal(true);
  });

  describe("itemId", () => {
    const malformedItemIds = ["not-a-uuid", "", "12345", "11111111-1111-1111-1111-11111111111"];
    for (const itemId of malformedItemIds) {
      it(`rejects a malformed UUID (${JSON.stringify(itemId)})`, () => {
        expect(parse(50, validAddress, itemId).success).to.equal(false);
      });
    }

    it("rejects a missing itemId", () => {
      const result = orderRequestSchema.safeParse({ quantity: 50, shippingAddress: validAddress });
      expect(result.success).to.equal(false);
    });

    it("rejects a numeric itemId (must be a UUID string)", () => {
      expect(parse(50, validAddress, 1).success).to.equal(false);
    });

    it("accepts a well-formed UUID", () => {
      expect(parse(50, validAddress, VALID_ITEM_ID).success).to.equal(true);
    });
  });

  describe("quantity", () => {
    for (const quantity of [0, -1, -50]) {
      it(`rejects non-positive quantity (${quantity})`, () => {
        expect(parse(quantity).success).to.equal(false);
      });
    }

    it("rejects a decimal quantity", () => {
      expect(parse(12.5).success).to.equal(false);
    });

    it("rejects a missing quantity", () => {
      const result = orderRequestSchema.safeParse({ itemId: VALID_ITEM_ID, shippingAddress: validAddress });
      expect(result.success).to.equal(false);
    });

    it("rejects a non-numeric quantity", () => {
      expect(parse("50").success).to.equal(false);
    });

    it("rejects NaN", () => {
      expect(parse(NaN).success).to.equal(false);
    });

    it("rejects Infinity", () => {
      expect(parse(Infinity).success).to.equal(false);
      expect(parse(-Infinity).success).to.equal(false);
    });

    it("accepts the smallest valid quantity", () => {
      expect(parse(1).success).to.equal(true);
    });
  });

  describe("shippingAddress", () => {
    for (const latitude of [90.0001, 91, -91]) {
      it(`rejects out-of-range latitude (${latitude})`, () => {
        expect(parse(50, { latitude, longitude: 0 }).success).to.equal(false);
      });
    }

    for (const longitude of [180.0001, 181, -181]) {
      it(`rejects out-of-range longitude (${longitude})`, () => {
        expect(parse(50, { latitude: 0, longitude }).success).to.equal(false);
      });
    }

    it("rejects NaN coordinates", () => {
      expect(parse(50, { latitude: NaN, longitude: 0 }).success).to.equal(false);
      expect(parse(50, { latitude: 0, longitude: NaN }).success).to.equal(false);
    });

    it("rejects Infinity coordinates", () => {
      expect(parse(50, { latitude: Infinity, longitude: 0 }).success).to.equal(false);
      expect(parse(50, { latitude: 0, longitude: -Infinity }).success).to.equal(false);
    });

    it("rejects missing shippingAddress", () => {
      const result = orderRequestSchema.safeParse({ itemId: VALID_ITEM_ID, quantity: 50 });
      expect(result.success).to.equal(false);
    });

    it("rejects missing latitude/longitude", () => {
      expect(parse(50, { longitude: 0 }).success).to.equal(false);
      expect(parse(50, { latitude: 0 }).success).to.equal(false);
    });

    it("rejects non-numeric coordinates", () => {
      expect(parse(50, { latitude: "40.7", longitude: -74 }).success).to.equal(false);
    });

    const boundaryAddresses = [
      { latitude: 90, longitude: 180 },
      { latitude: -90, longitude: -180 },
      { latitude: 0, longitude: 0 },
    ];
    for (const shippingAddress of boundaryAddresses) {
      it(`accepts boundary coordinates (${JSON.stringify(shippingAddress)})`, () => {
        expect(parse(50, shippingAddress).success).to.equal(true);
      });
    }
  });
});
