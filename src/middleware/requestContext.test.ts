import { afterEach, describe, expect, it, vi } from "vitest";
import Koa, { Context } from "koa";
import Router from "@koa/router";
import request from "supertest";
import { logger } from "../observability/logger";
import { errorHandler } from "./errorHandler";
import { requestContext } from "./requestContext";

function buildApp(handler: (ctx: Context) => void | Promise<void>): Koa {
  const app = new Koa();
  const router = new Router();

  router.get("/test/:id", handler);

  app.use(requestContext);
  app.use(errorHandler);
  app.use(router.routes());

  return app;
}

describe("requestContext middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a request ID and echoes it back on the response header", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
    });

    const response = await request(app.callback()).get("/test/1");

    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("reuses a client-supplied X-Request-Id instead of generating a new one", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { requestId: ctx.state.requestId };
    });

    const response = await request(app.callback()).get("/test/1").set("X-Request-Id", "client-supplied-id");

    expect(response.headers["x-request-id"]).toBe("client-supplied-id");
    expect(response.body.requestId).toBe("client-supplied-id");
  });

  it("attaches a child logger at ctx.state.log, usable by downstream handlers", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { hasLogger: typeof ctx.state.log?.info === "function" };
    });

    const response = await request(app.callback()).get("/test/1");

    expect(response.body).toEqual({ hasLogger: true });
  });

  it("logs exactly one structured completion line, with the matched route pattern (not the literal path)", async () => {
    const infoSpy = vi.spyOn(logger, "child").mockReturnValue(
      Object.assign(Object.create(logger), { info: vi.fn(), error: vi.fn() })
    );
    const app = buildApp((ctx) => {
      ctx.status = 200;
    });

    await request(app.callback()).get("/test/12345");

    const childLogger = infoSpy.mock.results[0]?.value;
    expect(childLogger.info).toHaveBeenCalledTimes(1);
    const [fields, message] = childLogger.info.mock.calls[0];
    expect(message).toBe("request completed");
    expect(fields.operation).toBe("GET /test/:id"); // pattern, not "/test/12345"
    expect(fields.status).toBe(200);
    expect(typeof fields.duration).toBe("number");
  });

  it("logs completion at error level (not info) for a 5xx response, including the errorCode", async () => {
    const errorFn = vi.fn();
    vi.spyOn(logger, "child").mockReturnValue(
      Object.assign(Object.create(logger), { info: vi.fn(), error: errorFn })
    );
    const app = buildApp(() => {
      throw new Error("boom");
    });

    await request(app.callback()).get("/test/1");

    expect(errorFn).toHaveBeenCalledTimes(2);
    const completionCall = errorFn.mock.calls.find(([, message]) => message === "request completed");
    expect(completionCall).toBeDefined();
    const [fields] = completionCall!;
    expect(fields.status).toBe(500);
    expect(fields.errorCode).toBe("INTERNAL_SERVER_ERROR");
  });

  it("includes orderNumber in the completion log when a handler sets ctx.state.orderNumber", async () => {
    const infoFn = vi.fn();
    vi.spyOn(logger, "child").mockReturnValue(Object.assign(Object.create(logger), { info: infoFn, error: vi.fn() }));
    const app = buildApp((ctx) => {
      ctx.state.orderNumber = "ORD-0000042";
      ctx.status = 201;
    });

    await request(app.callback()).get("/test/1");

    const [fields] = infoFn.mock.calls[0];
    expect(fields.orderNumber).toBe("ORD-0000042");
  });

  it("still logs completion (in a finally) even when the handler throws", async () => {
    const infoFn = vi.fn();
    const errorFn = vi.fn();
    vi.spyOn(logger, "child").mockReturnValue(Object.assign(Object.create(logger), { info: infoFn, error: errorFn }));
    const app = buildApp(() => {
      throw new Error("boom");
    });

    await request(app.callback()).get("/test/1");

    expect(infoFn).not.toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalledTimes(2);
    expect(errorFn.mock.calls.some(([, message]) => message === "request completed")).toBe(true);
  });
});
