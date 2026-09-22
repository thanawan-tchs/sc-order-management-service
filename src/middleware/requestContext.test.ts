import { expect } from "chai";
import Koa, { Context } from "koa";
import Router from "@koa/router";
import request from "supertest";
import sinon from "sinon";
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
    sinon.restore();
  });

  it("generates a request ID and echoes it back on the response header", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
    });

    const response = await request(app.callback()).get("/test/1");

    expect(Boolean(response.headers["x-request-id"])).to.equal(true);
    expect(response.headers["x-request-id"]).to.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("reuses a client-supplied X-Request-Id instead of generating a new one", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { requestId: ctx.state.requestId };
    });

    const response = await request(app.callback()).get("/test/1").set("X-Request-Id", "client-supplied-id");

    expect(response.headers["x-request-id"]).to.equal("client-supplied-id");
    expect(response.body.requestId).to.equal("client-supplied-id");
  });

  it("attaches a child logger at ctx.state.log, usable by downstream handlers", async () => {
    const app = buildApp((ctx) => {
      ctx.status = 200;
      ctx.body = { hasLogger: typeof ctx.state.log?.info === "function" };
    });

    const response = await request(app.callback()).get("/test/1");

    expect(response.body).to.deep.equal({ hasLogger: true });
  });

  it("logs exactly one structured completion line, with the matched route pattern (not the literal path)", async () => {
    const childLogger = { info: sinon.stub(), error: sinon.stub() };
    sinon.stub(logger, "child").returns(Object.assign(Object.create(logger), childLogger));
    const app = buildApp((ctx) => {
      ctx.status = 200;
    });

    await request(app.callback()).get("/test/12345");

    expect(childLogger.info.callCount).to.equal(1);
    const [fields, message] = childLogger.info.firstCall.args;
    expect(message).to.equal("request completed");
    expect(fields.operation).to.equal("GET /test/:id"); // pattern, not "/test/12345"
    expect(fields.status).to.equal(200);
    expect(typeof fields.duration).to.equal("number");
  });

  it("logs completion at error level (not info) for a 5xx response, including the errorCode", async () => {
    const childLogger = { info: sinon.stub(), error: sinon.stub() };
    sinon.stub(logger, "child").returns(Object.assign(Object.create(logger), childLogger));
    const app = buildApp(() => {
      throw new Error("boom");
    });

    await request(app.callback()).get("/test/1");

    expect(childLogger.error.callCount).to.equal(2);
    const completionCall = childLogger.error
      .getCalls()
      .find((call) => call.args[1] === "request completed");
    expect(completionCall).to.not.equal(undefined);
    const [fields] = completionCall!.args;
    expect(fields.status).to.equal(500);
    expect(fields.errorCode).to.equal("INTERNAL_SERVER_ERROR");
  });

  it("includes orderNumber in the completion log when a handler sets ctx.state.orderNumber", async () => {
    const childLogger = { info: sinon.stub(), error: sinon.stub() };
    sinon.stub(logger, "child").returns(Object.assign(Object.create(logger), childLogger));
    const app = buildApp((ctx) => {
      ctx.state.orderNumber = "ORD-0000042";
      ctx.status = 201;
    });

    await request(app.callback()).get("/test/1");

    const [fields] = childLogger.info.firstCall.args;
    expect(fields.orderNumber).to.equal("ORD-0000042");
  });

  it("still logs completion (in a finally) even when the handler throws", async () => {
    const childLogger = { info: sinon.stub(), error: sinon.stub() };
    sinon.stub(logger, "child").returns(Object.assign(Object.create(logger), childLogger));
    const app = buildApp(() => {
      throw new Error("boom");
    });

    await request(app.callback()).get("/test/1");

    expect(childLogger.info.called).to.equal(false);
    expect(childLogger.error.callCount).to.equal(2);
    expect(childLogger.error.getCalls().some((call) => call.args[1] === "request completed")).to.equal(true);
  });
});
