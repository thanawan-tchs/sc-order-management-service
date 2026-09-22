import { expect } from "chai";
import Koa, { Context } from "koa";
import Router from "@koa/router";
import request from "supertest";
import sinon from "sinon";
import exception from "@domain/errors";
import { logger } from "@observability/logger";
import { errorHandler } from "./errorHandler";

function buildApp(handler: (ctx: Context) => void | Promise<void>): Koa {
  const app = new Koa();
  const router = new Router();

  router.get("/test", handler);

  app.use(errorHandler);
  app.use(router.routes());

  return app;
}

describe("errorHandler middleware", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("maps a known AppError to its own status, code, and message", async () => {
    const app = buildApp(() => {
      throw new exception.OrderNotFoundError("ORD-1234567");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).to.equal(404);
    expect(response.body).to.deep.equal({
      error: {
        code: "ORDER_NOT_FOUND",
        message: 'No order found with order number "ORD-1234567".',
      },
    });
  });

  it("maps a ValidationError with its per-instance code", async () => {
    const app = buildApp(() => {
      throw new exception.ValidationError("INVALID_QUANTITY", "Quantity is required and must be a positive integer.");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).to.equal(400);
    expect(response.body.error.code).to.equal("INVALID_QUANTITY");
  });

  it("returns a generic 500 for an unexpected error, without leaking its message", async () => {
    sinon.stub(logger, "error").returns(undefined as never);
    const app = buildApp(() => {
      throw new Error("connection refused at db.internal:5432, password=hunter2");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
    });
    const rawBody = JSON.stringify(response.body);
    expect(rawBody).to.not.include("hunter2");
    expect(rawBody).to.not.include("db.internal");
    expect(rawBody).to.not.include("at "); // no stack trace fragment
  });

  it("logs the real error server-side even though the client only sees the generic message", async () => {
    const logSpy = sinon.stub(logger, "error").returns(undefined as never);
    const originalError = new Error("boom: something specific broke");
    const app = buildApp(() => {
      throw originalError;
    });

    await request(app.callback()).get("/test");

    expect(logSpy.callCount).to.equal(1);
    expect(logSpy.calledWith({ err: originalError }, "unhandled error while processing request")).to.equal(true);
  });

  it("returns 500 for a non-Error thrown value too, without crashing", async () => {
    sinon.stub(logger, "error").returns(undefined as never);
    const app = buildApp(() => {
      throw "just a string, not an Error instance";
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).to.equal(500);
    expect(response.body.error.code).to.equal("INTERNAL_SERVER_ERROR");
  });

  it("does not affect a handler that succeeds", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { ok: true };
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ ok: true });
  });
});
