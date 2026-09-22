import { expect } from "chai";
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import request from "supertest";
import { z } from "zod";
import { orderRequestSchema } from "../domain/validation/orderRequest.schema";
import { errorHandler } from "./errorHandler";
import { validateBody } from "./validateBody";

const schema = z.object({ quantity: z.number().int().positive() });

function buildTestApp() {
  const app = new Koa();
  const router = new Router();

  router.post("/test", validateBody(schema), (ctx) => {
    ctx.status = 200;
    ctx.body = { received: ctx.state.validated };
  });

  app.use(errorHandler);
  app.use(bodyParser());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}

describe("validateBody middleware", () => {
  it("calls the handler with the validated, typed data on success", async () => {
    const app = buildTestApp();

    const response = await request(app.callback()).post("/test").send({ quantity: 10 });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ received: { quantity: 10 } });
  });

  it("throws a ValidationError that the central error handler turns into 400 INVALID_QUANTITY", async () => {
    const app = buildTestApp();

    const response = await request(app.callback()).post("/test").send({ quantity: -1 });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_QUANTITY");
    expect(typeof response.body.error.message).to.equal("string");
  });

  it("never calls the downstream handler when validation fails", async () => {
    const app = new Koa();
    const router = new Router();
    let handlerCalled = false;

    router.post("/test", validateBody(schema), (ctx) => {
      handlerCalled = true;
      ctx.status = 200;
    });

    app.use(errorHandler);
    app.use(bodyParser());
    app.use(router.routes());

    await request(app.callback()).post("/test").send({ quantity: "not-a-number" });

    expect(handlerCalled).to.equal(false);
  });
});

describe("validateBody field-to-code mapping (ticket 15, against the real order request schema)", () => {
  function buildOrderRequestApp() {
    const app = new Koa();
    const router = new Router();

    router.post("/test", validateBody(orderRequestSchema), (ctx) => {
      ctx.status = 200;
      ctx.body = { received: ctx.state.validated };
    });

    app.use(errorHandler);
    app.use(bodyParser());
    app.use(router.routes());

    return app;
  }

  const validAddress = { latitude: 40.7128, longitude: -74.006 };
  const VALID_ITEM_ID = "11111111-1111-1111-1111-111111111111";

  it("maps an invalid itemId to INVALID_ITEM_ID", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: "not-a-uuid", quantity: 10, shippingAddress: validAddress });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_ITEM_ID");
  });

  it("maps an invalid quantity to INVALID_QUANTITY", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: VALID_ITEM_ID, quantity: -1, shippingAddress: validAddress });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_QUANTITY");
  });

  it("maps an invalid latitude to INVALID_LATITUDE", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: VALID_ITEM_ID, quantity: 10, shippingAddress: { latitude: 999, longitude: -74.006 } });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_LATITUDE");
  });

  it("maps an invalid longitude to INVALID_LONGITUDE", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: VALID_ITEM_ID, quantity: 10, shippingAddress: { latitude: 40.7128, longitude: 999 } });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_LONGITUDE");
  });

  it("maps anything else (e.g. a missing shippingAddress) to the generic VALIDATION_ERROR fallback", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: VALID_ITEM_ID, quantity: 10 });

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("VALIDATION_ERROR");
  });

  it("passes a fully valid request through untouched", async () => {
    const response = await request(buildOrderRequestApp().callback())
      .post("/test")
      .send({ itemId: VALID_ITEM_ID, quantity: 10, shippingAddress: validAddress });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      received: { itemId: VALID_ITEM_ID, quantity: 10, shippingAddress: validAddress },
    });
  });
});
