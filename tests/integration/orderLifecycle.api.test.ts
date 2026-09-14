import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { ITEM_WEIGHT_KG } from "../../src/config";
import { closePool, getPool } from "../../src/infrastructure/db/pool";
import { resetTestDb } from "../helpers/db";
import { pointAtDistanceFrom } from "../helpers/geo";

/**
 * Ticket 16: confidence in the COMPLETE order lifecycle — quote, submit, and get chained
 * together for the same request, not just each endpoint tested in isolation (which the other
 * integration test files already do thoroughly). Also closes two specific gaps that audit found:
 * no integration test exercised a *valid* quantity-1 order (only the invalid-shipping edge case
 * happened to use quantity 1), and "shipping exactly 15%" was only verified at the application
 * service level, never through real HTTP requests.
 */

const app = createApp();

const NYC = { latitude: 40.7128, longitude: -74.006 };
const NEW_YORK_ID = 2;
const ALL_WAREHOUSE_IDS = [1, 2, 3, 4, 5, 6];

async function repositionWarehouse(
  id: number,
  origin: { latitude: number; longitude: number },
  distanceKm: number,
  stock: number
): Promise<void> {
  const { latitude, longitude } = pointAtDistanceFrom(origin, distanceKm);
  const pool = getPool();
  await pool.query("UPDATE warehouses SET latitude = $1, longitude = $2 WHERE id = $3", [
    latitude,
    longitude,
    id,
  ]);
  await pool.query("UPDATE inventory SET stock = $1 WHERE warehouse_id = $2", [stock, id]);
}

async function zeroOutStock(ids: number[]): Promise<void> {
  const pool = getPool();
  for (const id of ids) {
    await pool.query("UPDATE inventory SET stock = 0 WHERE warehouse_id = $1", [id]);
  }
}

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("order lifecycle: quote -> submit -> get stay consistent", () => {
  // Every discount-tier boundary quantity ticket 16 calls out by name, plus 1 (the smallest
  // possible order) and 24 (just under the first tier).
  it.each([1, 24, 25, 49, 50, 99, 100, 249, 250])(
    "quantity %i: the quote is an accurate preview of what submit persists, and get returns exactly that",
    async (quantity) => {
      await repositionWarehouse(NEW_YORK_ID, NYC, 10, 1000);

      const quoteResponse = await request(app.callback())
        .post("/v1/orders/quote")
        .send({ quantity, shippingAddress: NYC });
      expect(quoteResponse.status).toBe(200);
      expect(quoteResponse.body.valid).toBe(true);
      expect(quoteResponse.body.quantity).toBe(quantity);

      const submitResponse = await request(app.callback())
        .post("/v1/orders")
        .send({ quantity, shippingAddress: NYC });
      expect(submitResponse.status).toBe(201);

      // The quote is a preview of exactly what submit produces — same pricing, same allocation.
      expect(submitResponse.body.pricing).toEqual(quoteResponse.body.pricing);
      expect(submitResponse.body.shipping.allocations).toEqual(quoteResponse.body.shipping.allocations);

      const getResponse = await request(app.callback()).get(
        `/v1/orders/${submitResponse.body.orderNumber}`
      );
      expect(getResponse.status).toBe(200);

      // What was submitted is exactly what's retrievable afterward.
      expect(getResponse.body.quantity).toBe(quantity);
      expect(getResponse.body.pricing).toEqual(submitResponse.body.pricing);
      expect(getResponse.body.shipping.allocations).toEqual(submitResponse.body.shipping.allocations);
      expect(getResponse.body.status).toBe("CONFIRMED");
    }
  );
});

describe("shipping cost exactly at 15% (ticket 16 scenario 13)", () => {
  it("quote reports it valid, and it submits successfully, through real HTTP requests", async () => {
    // qty 1: no discount, amountAfterDiscount = 15000 cents, 15% limit = 2250 cents exactly.
    // Choosing the distance that puts shippingCostCents exactly on that boundary. Other
    // warehouses are zeroed out so a real-world-positioned one can't end up cheaper than New
    // York once it's artificially moved this far away.
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    const distanceForExactly2250Cents = 2250 / (1 * ITEM_WEIGHT_KG);
    await repositionWarehouse(NEW_YORK_ID, NYC, distanceForExactly2250Cents, 10);

    const quoteResponse = await request(app.callback())
      .post("/v1/orders/quote")
      .send({ quantity: 1, shippingAddress: NYC });

    expect(quoteResponse.status).toBe(200);
    expect(quoteResponse.body.pricing.amountAfterDiscountCents).toBe(15000);
    expect(quoteResponse.body.pricing.shippingCents).toBe(2250);
    expect(quoteResponse.body.valid).toBe(true);
    expect(quoteResponse.body.invalidReason).toBeNull();

    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ quantity: 1, shippingAddress: NYC });

    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.pricing.shippingCents).toBe(2250);
  });

  it("one cent over the boundary is invalid at quote and rejected at submit", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    const distanceForExactly2251Cents = 2251 / (1 * ITEM_WEIGHT_KG);
    await repositionWarehouse(NEW_YORK_ID, NYC, distanceForExactly2251Cents, 10);

    const quoteResponse = await request(app.callback())
      .post("/v1/orders/quote")
      .send({ quantity: 1, shippingAddress: NYC });

    expect(quoteResponse.body.pricing.shippingCents).toBe(2251);
    expect(quoteResponse.body.valid).toBe(false);
    expect(quoteResponse.body.invalidReason).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");

    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ quantity: 1, shippingAddress: NYC });

    expect(submitResponse.status).toBe(422);
    expect(submitResponse.body.error.code).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");
  });
});
