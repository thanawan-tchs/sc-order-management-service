import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { closePool } from "../../src/infrastructure/db/pool";
import * as warehouseRepository from "../../src/repositories/warehouseRepository";
import { resetTestDb } from "../helpers/db";

const app = createApp();

let itemId: string;

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("POST /v1/orders/quote", () => {
  it("returns 200 with a correct, internally-consistent quote (ticket 09's own worked example)", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: 50,
        shippingAddress: { latitude: 40.7128, longitude: -74.006 },
      });

    expect(response.status).toBe(200);

    expect(response.body.quantity).toBe(50);
    expect(response.body.pricing.subtotal).toBe(750000);
    expect(response.body.pricing.discountRate).toBe(0.1);
    expect(response.body.pricing.discount).toBe(75000);
    expect(response.body.pricing.amountAfterDiscount).toBe(675000);
    expect(response.body.shipping.totalWeightKg).toBe(18.25);

    expect(response.body.pricing.total).toBe(
      response.body.pricing.amountAfterDiscount + response.body.pricing.shippingCost
    );
    expect(response.body.pricing.shippingCost).toBeGreaterThan(0);
    expect(response.body.shipping.allocations).toHaveLength(1);
    expect(response.body.shipping.allocations[0].distanceKm).toBeGreaterThan(10);
    expect(response.body.shipping.allocations[0].distanceKm).toBeLessThan(40);

    expect(response.body.valid).toBe(true);
    expect(response.body.invalidReason).toBeNull();
  });

  it("allocates entirely from the nearest warehouse, matching the requested quantity", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: 10,
        shippingAddress: { latitude: 40.7128, longitude: -74.006 },
      });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.invalidReason).toBeNull();

    const totalAllocated = response.body.shipping.allocations.reduce(
      (sum: number, line: { quantity: number }) => sum + line.quantity,
      0
    );
    expect(totalAllocated).toBe(10);
  });

  it("returns 200 with valid: false and INSUFFICIENT_STOCK when the order exceeds total stock", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: 3000,
        shippingAddress: { latitude: 40.7128, longitude: -74.006 },
      });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(false);
    expect(response.body.invalidReason).toBe("INSUFFICIENT_STOCK");
  });

  it("returns 200 with valid: false and SHIPPING_COST_EXCEEDS_15_PERCENT for a tiny order to a far destination", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: 1,
        shippingAddress: { latitude: -10, longitude: 165 },
      });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(false);
    expect(response.body.invalidReason).toBe("SHIPPING_COST_EXCEEDS_15_PERCENT");
  });

  it("returns 400 with INVALID_QUANTITY for a malformed request (ticket 15's error contract)", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: -5,
        shippingAddress: { latitude: 999, longitude: -74.006 },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_QUANTITY");
    expect(typeof response.body.error.message).toBe("string");
  });

  it("returns 400 with the generic VALIDATION_ERROR code for a missing shippingAddress", async () => {
    const response = await request(app.callback())
      .post("/v1/orders/quote")
      .send({ itemId: itemId, quantity: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("has no side effects: warehouse stock is unchanged after quoting", async () => {
    const before = await warehouseRepository.getAllWarehouses();
    const stockBefore = await Promise.all(before.map((w) => warehouseRepository.getInventory(w.id, itemId)));

    await request(app.callback())
      .post("/v1/orders/quote")
      .send({
        itemId: itemId,
        quantity: 50,
        shippingAddress: { latitude: 40.7128, longitude: -74.006 },
      });

    const after = await warehouseRepository.getAllWarehouses();
    const stockAfter = await Promise.all(after.map((w) => warehouseRepository.getInventory(w.id, itemId)));

    expect(stockAfter).toEqual(stockBefore);
  });
});
