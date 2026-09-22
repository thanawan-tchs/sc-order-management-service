import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { closePool, getPool } from "../../src/infrastructure/db/pool";
import { resetTestDb } from "../helpers/db";
import { pointAtDistanceFrom } from "../helpers/geo";

const app = createApp();

const NYC = { latitude: 40.7128, longitude: -74.006 };
const NEW_YORK_ID = 2;
const ALL_WAREHOUSE_IDS = [1, 2, 3, 4, 5, 6];
let itemId: string;
const UNIT_WEIGHT_KG = 0.365;

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
  await pool.query("UPDATE inventory SET stock = $1 WHERE warehouse_id = $2 AND item_id = $3", [
    stock,
    id,
    itemId,
  ]);
}

async function zeroOutStock(ids: number[]): Promise<void> {
  const pool = getPool();
  for (const id of ids) {
    await pool.query("UPDATE inventory SET stock = 0 WHERE warehouse_id = $1 AND item_id = $2", [
      id,
      itemId,
    ]);
  }
}

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("order lifecycle: quote -> submit -> get stay consistent", () => {
  it.each([1, 24, 25, 49, 50, 99, 100, 249, 250])(
    "quantity %i: the quote is an accurate preview of what submit persists, and get returns exactly that",
    async (quantity) => {
      await repositionWarehouse(NEW_YORK_ID, NYC, 10, 1000);

      const quoteResponse = await request(app.callback())
        .post("/v1/orders/quote")
        .send({ itemId: itemId, quantity, shippingAddress: NYC });
      expect(quoteResponse.status).toBe(200);
      expect(quoteResponse.body.valid).toBe(true);
      expect(quoteResponse.body.quantity).toBe(quantity);

      const submitResponse = await request(app.callback())
        .post("/v1/orders")
        .send({ itemId: itemId, quantity, shippingAddress: NYC });
      expect(submitResponse.status).toBe(201);

      expect(submitResponse.body.pricing).toEqual(quoteResponse.body.pricing);
      expect(submitResponse.body.shipping.allocations).toEqual(
        quoteResponse.body.shipping.allocations
      );

      const getResponse = await request(app.callback()).get(
        `/v1/orders/${submitResponse.body.orderNumber}`
      );
      expect(getResponse.status).toBe(200);

      expect(getResponse.body.quantity).toBe(quantity);
      expect(getResponse.body.pricing).toEqual(submitResponse.body.pricing);
      expect(getResponse.body.shipping.allocations).toEqual(
        submitResponse.body.shipping.allocations
      );
      expect(getResponse.body.status).toBe("CONFIRMED");
    }
  );
});

describe("shipping cost exactly at 15% (ticket 16 scenario 13)", () => {
  it("quote reports it valid, and it submits successfully, through real HTTP requests", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    const distanceForExactly2250Cents = 2250 / (1 * UNIT_WEIGHT_KG);
    await repositionWarehouse(NEW_YORK_ID, NYC, distanceForExactly2250Cents, 10);

    const quoteResponse = await request(app.callback())
      .post("/v1/orders/quote")
      .send({ itemId: itemId, quantity: 1, shippingAddress: NYC });

    expect(quoteResponse.status).toBe(200);
    expect(quoteResponse.body.pricing.amountAfterDiscount).toBe(15000);
    expect(quoteResponse.body.pricing.shippingCost).toBe(2250);
    expect(quoteResponse.body.valid).toBe(true);
    expect(quoteResponse.body.invalidReason).toBeNull();

    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 1, shippingAddress: NYC });

    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.pricing.shippingCost).toBe(2250);
  });

  it("one cent over the boundary is invalid at quote and rejected at submit", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    const distanceForExactly2251Cents = 2251 / (1 * UNIT_WEIGHT_KG);
    await repositionWarehouse(NEW_YORK_ID, NYC, distanceForExactly2251Cents, 10);

    const quoteResponse = await request(app.callback())
      .post("/v1/orders/quote")
      .send({ itemId: itemId, quantity: 1, shippingAddress: NYC });

    expect(quoteResponse.body.pricing.shippingCost).toBe(2251);
    expect(quoteResponse.body.valid).toBe(false);
    expect(quoteResponse.body.invalidReason).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");

    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 1, shippingAddress: NYC });

    expect(submitResponse.status).toBe(422);
    expect(submitResponse.body.error.code).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");
  });
});
