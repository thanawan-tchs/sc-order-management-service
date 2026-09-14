import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import Koa from "koa";
import { createApp } from "./app";
import { closePool } from "./infrastructure/db/pool";
import { registry } from "./observability/metrics";

afterAll(async () => {
  await closePool();
});

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

  it("does not depend on the database (still responds even if it were down)", async () => {
    // /health is a liveness check ("is the process alive"), not readiness — it must never touch
    // the database. There's no DB call in getHealth at all, so this is really documentation via
    // a passing test rather than something that could plausibly fail.
    const app = createApp();
    const response = await request(app.callback()).get("/health");
    expect(response.status).toBe(200);
  });
});

describe("GET /ready", () => {
  it("returns 200 with status ready when the database is reachable", async () => {
    const app = createApp();

    const response = await request(app.callback()).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });
});

describe("GET /metrics", () => {
  it("returns Prometheus text-format metrics, including the HTTP request counters", async () => {
    const app = createApp();

    // Generate at least one request so http_requests_total has a sample to report.
    await request(app.callback()).get("/health");

    const response = await request(app.callback()).get("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("http_requests_total");
    expect(response.text).toContain("http_request_duration_seconds");
  });

  it("reflects the shared metrics registry, not some separate copy", async () => {
    // Not a byte-for-byte comparison against a second registry.metrics() call: the /metrics
    // request itself is recorded (by requestContext) only *after* its own response body is
    // built, so a call made afterward would already show one more request than the response
    // just returned. Asserting on the counter's own recorded value instead sidesteps that.
    const app = createApp();
    const before = registry.getSingleMetric("quote_requests_total");
    const beforeValue = (await before?.get())?.values[0]?.value ?? 0;

    await request(app.callback()).post("/v1/orders/quote").send({
      quantity: 1,
      shippingAddress: { latitude: 0, longitude: 0 },
    });
    const response = await request(app.callback()).get("/metrics");

    const match = response.text.match(/^quote_requests_total (\d+)/m);
    expect(Number(match?.[1])).toBe(beforeValue + 1);
  });
});
