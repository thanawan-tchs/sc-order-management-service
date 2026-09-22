import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { closePool } from "../../src/infrastructure/db/pool";
import { resetTestDb } from "../helpers/db";

const app = createApp();

let itemId: string;

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("POST /v1/items", () => {
  it("creates an item and returns 201 with the generated id", async () => {
    const response = await request(app.callback())
      .post("/v1/items")
      .send({ name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: "Deluxe Unit",
      priceCents: 25000,
      weightKg: 1.2,
    });
    expect(response.body.id).not.toBe(itemId);
  });

  it("the created item is immediately retrievable via GET /v1/items/:itemId", async () => {
    const createResponse = await request(app.callback())
      .post("/v1/items")
      .send({ name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });

    const getResponse = await request(app.callback()).get(`/v1/items/${createResponse.body.id}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual(createResponse.body);
  });

  it("400 INVALID_ITEM_NAME for a missing/empty name", async () => {
    const response = await request(app.callback())
      .post("/v1/items")
      .send({ name: "", priceCents: 25000, weightKg: 1.2 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ITEM_NAME");
  });

  it("400 INVALID_PRICE_CENTS for a non-positive priceCents", async () => {
    const response = await request(app.callback())
      .post("/v1/items")
      .send({ name: "Deluxe Unit", priceCents: 0, weightKg: 1.2 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PRICE_CENTS");
  });

  it("400 INVALID_WEIGHT_KG for a non-positive weightKg", async () => {
    const response = await request(app.callback())
      .post("/v1/items")
      .send({ name: "Deluxe Unit", priceCents: 25000, weightKg: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_WEIGHT_KG");
  });
});

describe("GET /v1/items", () => {
  it("returns the seeded item when nothing else has been created", async () => {
    const response = await request(app.callback()).get("/v1/items");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: itemId, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 }]);
  });

  it("includes newly created items", async () => {
    const createResponse = await request(app.callback())
      .post("/v1/items")
      .send({ name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });

    const response = await request(app.callback()).get("/v1/items");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual(
      expect.arrayContaining([
        { id: itemId, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 },
        createResponse.body,
      ])
    );
  });
});

describe("GET /v1/items/:itemId", () => {
  it("returns 200 with the seeded item", async () => {
    const response = await request(app.callback()).get(`/v1/items/${itemId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: itemId, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 });
  });

  it("returns 404 ITEM_NOT_FOUND for a well-formed but unknown itemId", async () => {
    const response = await request(app.callback()).get(
      "/v1/items/00000000-0000-0000-0000-000000000000"
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ITEM_NOT_FOUND");
  });

  it("returns 400 INVALID_ITEM_ID for a malformed itemId, not a 500", async () => {
    const response = await request(app.callback()).get("/v1/items/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ITEM_ID");
  });
});
