import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { closePool, getPool } from "../../src/infrastructure/db/pool";
import { resetTestDb } from "../helpers/db";
import { pointAtDistanceFrom } from "../helpers/geo";

const app = createApp();

const NYC = { latitude: 40.7128, longitude: -74.006 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;

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

describe("GET /v1/orders/:orderNumber", () => {
  it("returns 200 with the correct order for an existing order number", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);
    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ quantity: 20, shippingAddress: NYC });
    expect(submitResponse.status).toBe(201);

    const response = await request(app.callback()).get(`/v1/orders/${submitResponse.body.orderNumber}`);

    expect(response.status).toBe(200);
    expect(response.body.orderNumber).toBe(submitResponse.body.orderNumber);
    expect(response.body.status).toBe("CONFIRMED");
    expect(response.body.quantity).toBe(20);
    expect(response.body.destination).toEqual(NYC);
    expect(response.body.pricing).toEqual(submitResponse.body.pricing);
    expect(response.body.shipping.allocations).toEqual(submitResponse.body.shipping.allocations);
    expect(typeof response.body.createdAt).toBe("string");
    expect(new Date(response.body.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("returns 404 with ticket 15's error contract for an unknown order number", async () => {
    const response = await request(app.callback()).get("/v1/orders/ORD-9999999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    expect(typeof response.body.error.message).toBe("string");
  });

  it("returns 404 for a garbage order number, not a 500", async () => {
    const response = await request(app.callback()).get("/v1/orders/not-a-real-format");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("returns the full allocation set for a multi-warehouse order", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, NYC, 10, 15);
    await repositionWarehouse(NEW_YORK_ID, NYC, 20, 100);
    await zeroOutStock([3, 4, 5, 6]);

    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ quantity: 20, shippingAddress: NYC });
    expect(submitResponse.status).toBe(201);

    const response = await request(app.callback()).get(`/v1/orders/${submitResponse.body.orderNumber}`);

    expect(response.status).toBe(200);
    expect(response.body.shipping.allocations).toHaveLength(2);
    expect(response.body.shipping.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 15 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 5 }),
      ])
    );
  });

  it("returns the historical snapshot unchanged, even after the underlying pricing configuration would produce something different", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);
    const submitResponse = await request(app.callback())
      .post("/v1/orders")
      .send({ quantity: 20, shippingAddress: NYC });
    expect(submitResponse.status).toBe(201);

    // Simulate "pricing rules changed since this order was placed" by directly corrupting the
    // stored snapshot to values today's pricing.ts could never produce for this quantity. If the
    // GET endpoint recalculated anything, it would return the *original*, real numbers instead
    // of these — so getting these back proves it reads the stored row verbatim.
    await getPool().query(
      "UPDATE orders SET discount_rate = $1, discount_cents = $2, amount_after_discount_cents = $3 WHERE order_number = $4",
      [0.42, 63000, 87000, submitResponse.body.orderNumber]
    );

    const response = await request(app.callback()).get(`/v1/orders/${submitResponse.body.orderNumber}`);

    expect(response.status).toBe(200);
    expect(response.body.pricing.discountRate).toBe(0.42);
    expect(response.body.pricing.discountCents).toBe(63000);
    expect(response.body.pricing.amountAfterDiscountCents).toBe(87000);
  });
});
