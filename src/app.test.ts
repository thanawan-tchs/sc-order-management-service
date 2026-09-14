import { describe, expect, it } from "vitest";
import request from "supertest";
import Koa from "koa";
import { createApp } from "./app";

describe("app bootstrap", () => {
  it("boots and returns a usable Koa application", () => {
    const app = createApp();
    expect(app).toBeInstanceOf(Koa);
  });
});

describe("GET /health", () => {
  it("returns 200 with the expected body", async () => {
    const app = createApp();

    const response = await request(app.callback()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
