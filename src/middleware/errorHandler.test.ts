import { afterEach, describe, expect, it, vi } from "vitest";
import Koa, { Context } from "koa";
import Router from "@koa/router";
import request from "supertest";
import { OrderNotFoundError, ValidationError } from "../domain/errors";
import { logger } from "../observability/logger";
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
    vi.restoreAllMocks();
  });

  it("maps a known AppError to its own status, code, and message", async () => {
    const app = buildApp(() => {
      throw new OrderNotFoundError("ORD-1234567");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "ORDER_NOT_FOUND",
        message: 'No order found with order number "ORD-1234567".',
      },
    });
  });

  it("maps a ValidationError with its per-instance code", async () => {
    const app = buildApp(() => {
      throw new ValidationError("INVALID_QUANTITY", "Quantity is required and must be a positive integer.");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_QUANTITY");
  });

  it("returns a generic 500 for an unexpected error, without leaking its message", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    const app = buildApp(() => {
      throw new Error("connection refused at db.internal:5432, password=hunter2");
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
    });
    const rawBody = JSON.stringify(response.body);
    expect(rawBody).not.toContain("hunter2");
    expect(rawBody).not.toContain("db.internal");
    expect(rawBody).not.toContain("at "); // no stack trace fragment
  });

  it("logs the real error server-side even though the client only sees the generic message", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    const originalError = new Error("boom: something specific broke");
    const app = buildApp(() => {
      throw originalError;
    });

    await request(app.callback()).get("/test");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith({ err: originalError }, "unhandled error while processing request");
  });

  it("returns 500 for a non-Error thrown value too, without crashing", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    const app = buildApp(() => {
      throw "just a string, not an Error instance";
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("does not affect a handler that succeeds", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { ok: true };
    });

    const response = await request(app.callback()).get("/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
