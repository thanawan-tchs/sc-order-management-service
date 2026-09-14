import { describe, expect, it } from "vitest";
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import request from "supertest";
import { z } from "zod";
import { validateBody } from "../../src/middleware/validateBody";

const schema = z.object({ quantity: z.number().int().positive() });

function buildTestApp() {
  const app = new Koa();
  const router = new Router();

  router.post("/test", validateBody(schema), (ctx) => {
    ctx.status = 200;
    ctx.body = { received: ctx.state.validated };
  });

  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}

describe("validateBody middleware", () => {
  it("calls the handler with the validated, typed data on success", async () => {
    const app = buildTestApp();

    const response = await request(app.callback()).post("/test").send({ quantity: 10 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: { quantity: 10 } });
  });

  it("short-circuits with 400 and validation details on invalid input", async () => {
    const app = buildTestApp();

    const response = await request(app.callback()).post("/test").send({ quantity: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("VALIDATION_ERROR");
    expect(Array.isArray(response.body.details)).toBe(true);
    expect(response.body.details.length).toBeGreaterThan(0);
  });

  it("never calls the downstream handler when validation fails", async () => {
    const app = new Koa();
    const router = new Router();
    let handlerCalled = false;

    router.post("/test", validateBody(schema), (ctx) => {
      handlerCalled = true;
      ctx.status = 200;
    });

    app.use(bodyParser());
    app.use(router.routes());

    await request(app.callback()).post("/test").send({ quantity: "not-a-number" });

    expect(handlerCalled).toBe(false);
  });
});
