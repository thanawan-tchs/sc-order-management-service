import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@app";
import { closePool, getPool } from "@infrastructure/db/pool";
import orderRepository from "@repositories/orderRepository";
import warehouseRepository from "@repositories/warehouseRepository";
import { resetTestDb } from "../helpers/db";
import { pointAtDistanceFrom } from "../helpers/geo";

const app = createApp();

const NYC = { latitude: 40.7128, longitude: -74.006 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;
const ALL_WAREHOUSE_IDS = [1, 2, 3, 4, 5, 6];
let itemId: string;

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

async function countOrders(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    "SELECT COUNT(*)::int AS count FROM orders"
  );
  return Number(rows[0].count);
}

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("POST /v1/orders", () => {
  it("returns 201 with a correct, internally-consistent order (ticket 12's own worked example)", async () => {
    const response = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 100, shippingAddress: NYC });

    expect(response.status).toBe(201);
    expect(response.body.orderNumber).toMatch(/^ORD-\d{7}$/);
    expect(response.body.status).toBe("CONFIRMED");
    expect(response.body.quantity).toBe(100);

    expect(response.body.pricing.subtotal).toBe(15000);
    expect(response.body.pricing.discountRate).toBe(0.15);
    expect(response.body.pricing.discount).toBe(2250);
    expect(response.body.pricing.amountAfterDiscount).toBe(12750);

    expect(response.body.pricing.total).toBe(
      response.body.pricing.amountAfterDiscount + response.body.pricing.shippingCost
    );
    expect(response.body.shipping.allocations).toEqual([
      expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 100 }),
    ]);

    const fetched = await orderRepository.getOrderByNumber(response.body.orderNumber);
    expect(fetched?.quantity).toBe(100);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(578 - 100);
  });

  it("returns 201 and splits across multiple warehouses when one alone can't fulfill it", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, NYC, 10, 15);
    await repositionWarehouse(NEW_YORK_ID, NYC, 20, 100);
    await zeroOutStock([3, 4, 5, 6]);

    const response = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 20, shippingAddress: NYC });

    expect(response.status).toBe(201);
    expect(response.body.shipping.allocations).toHaveLength(2);
    expect(response.body.shipping.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: LOS_ANGELES_ID, quantity: 15 }),
        expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 5 }),
      ])
    );

    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, itemId))?.stock).toBe(0);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(95);
  });

  it("returns 400 for a malformed request, with a consistent validation error shape, and creates nothing", async () => {
    const before = await countOrders();

    const response = await request(app.callback())
      .post("/v1/orders")
      .send({
        itemId: itemId,
        quantity: -5,
        shippingAddress: { latitude: 999, longitude: -74.006 },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_QUANTITY");
    expect(await countOrders()).toBe(before);
  });

  it("returns 422 with code INSUFFICIENT_STOCK, and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 5);
    const before = await countOrders();

    const response = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 100, shippingAddress: NYC });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(5);
    expect(await countOrders()).toBe(before);
  });

  it("returns 422 with code SHIPPING_COST_EXCEEDS_15_PERCENT, and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(NEW_YORK_ID, NYC, 10000, 10);
    const before = await countOrders();

    const response = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 1, shippingAddress: NYC });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(10);
    expect(await countOrders()).toBe(before);
  });

  it("cannot have its pricing overridden by the client: extra fields in the body are ignored", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);

    const response = await request(app.callback())
      .post("/v1/orders")
      .send({
        itemId: itemId,
        quantity: 10,
        shippingAddress: NYC,
        subtotal: 1,
        discount: 999999,
        shippingCost: 0,
        total: 1,
        valid: false,
        allocations: [{ warehouseId: 999, quantity: 10, distanceKm: 0, shippingCost: 0 }],
      });

    expect(response.status).toBe(201);
    expect(response.body.pricing.subtotal).toBe(1500);
    expect(response.body.pricing.discount).toBe(0);
    expect(response.body.pricing.shippingCost).toBeGreaterThan(0);
    expect(response.body.shipping.allocations).toEqual([
      expect.objectContaining({ warehouseId: NEW_YORK_ID, quantity: 10 }),
    ]);
  });

  it("under an inventory conflict, exactly one of two racing submissions succeeds (409 for the other)", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 10);
    const before = await countOrders();

    const responses = await Promise.all([
      request(app.callback())
        .post("/v1/orders")
        .send({ itemId: itemId, quantity: 8, shippingAddress: NYC }),
      request(app.callback())
        .post("/v1/orders")
        .send({ itemId: itemId, quantity: 8, shippingAddress: NYC }),
    ]);

    const created = responses.filter((r) => r.status === 201);
    const conflicted = responses.filter((r) => r.status !== 201);
    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect([409, 422]).toContain(conflicted[0].status);

    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(2);
    expect(await countOrders()).toBe(before + 1);
  });

  it("has no side effects on the warehouses read endpoint's underlying data when rejected", async () => {
    const before = await warehouseRepository.getAllWarehouses();
    const stockBefore = await Promise.all(before.map((w) => warehouseRepository.getInventory(w.id, itemId)));

    await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 999999, shippingAddress: NYC });

    const after = await warehouseRepository.getAllWarehouses();
    const stockAfter = await Promise.all(after.map((w) => warehouseRepository.getInventory(w.id, itemId)));
    expect(stockAfter).toEqual(stockBefore);
  });
});

describe("POST /v1/orders — Idempotency-Key (ticket 13)", () => {
  it("returns the same order for the same key sent twice, and creates only one order", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);
    const before = await countOrders();

    const first = await request(app.callback())
      .post("/v1/orders")
      .set("Idempotency-Key", "http-retry-1")
      .send({ itemId: itemId, quantity: 20, shippingAddress: NYC });
    const second = await request(app.callback())
      .post("/v1/orders")
      .set("Idempotency-Key", "http-retry-1")
      .send({ itemId: itemId, quantity: 20, shippingAddress: NYC });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.orderNumber).toBe(first.body.orderNumber);
    expect(second.body).toEqual(first.body);

    expect(await countOrders()).toBe(before + 1);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(80);
  });

  it("treats requests with no Idempotency-Key header as always distinct", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);

    const first = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 5, shippingAddress: NYC });
    const second = await request(app.callback())
      .post("/v1/orders")
      .send({ itemId: itemId, quantity: 5, shippingAddress: NYC });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.orderNumber).not.toBe(first.body.orderNumber);
  });

  it("under a concurrent submission with the same key, both responses carry the same order", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);
    const before = await countOrders();

    const [a, b] = await Promise.all([
      request(app.callback())
        .post("/v1/orders")
        .set("Idempotency-Key", "http-concurrent-1")
        .send({ itemId: itemId, quantity: 20, shippingAddress: NYC }),
      request(app.callback())
        .post("/v1/orders")
        .set("Idempotency-Key", "http-concurrent-1")
        .send({ itemId: itemId, quantity: 20, shippingAddress: NYC }),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.orderNumber).toBe(b.body.orderNumber);
    expect(await countOrders()).toBe(before + 1);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(80);
  });

  it("returns 409 IDEMPOTENCY_KEY_REUSED when the same key is sent with a different request body", async () => {
    await repositionWarehouse(NEW_YORK_ID, NYC, 10, 100);

    const first = await request(app.callback())
      .post("/v1/orders")
      .set("Idempotency-Key", "http-reused-key")
      .send({ itemId: itemId, quantity: 20, shippingAddress: NYC });
    expect(first.status).toBe(201);

    const second = await request(app.callback())
      .post("/v1/orders")
      .set("Idempotency-Key", "http-reused-key")
      .send({ itemId: itemId, quantity: 21, shippingAddress: NYC });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await countOrders()).toBe(1);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, itemId))?.stock).toBe(80);
  });
});
