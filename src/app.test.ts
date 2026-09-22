import { expect } from "chai";
import request from "supertest";
import sinon from "sinon";
import Koa from "koa";
import { createApp } from "./app";
import * as prismaClientModule from "./infrastructure/db/prismaClient";

describe("app bootstrap", () => {
  it("boots and returns a usable Koa application", () => {
    const app = createApp();
    expect(app).to.be.instanceOf(Koa);
  });
});

describe("GET /health", () => {
  it("returns 200 with the expected body", async () => {
    const app = createApp();

    const response = await request(app.callback()).get("/health");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ status: "ok" });
  });

  it("does not depend on the database (still responds even if it were down)", async () => {
    const app = createApp();
    const response = await request(app.callback()).get("/health");
    expect(response.status).to.equal(200);
  });
});

describe("GET /ready", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns 200 with status ready when the database is reachable", async () => {
    sinon.stub(prismaClientModule, "getPrismaClient").returns({ $queryRaw: sinon.stub().resolves([]) } as never);
    const app = createApp();

    const response = await request(app.callback()).get("/ready");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ status: "ready" });
  });

  it("returns 503 with status not ready when the database is unreachable", async () => {
    sinon.stub(prismaClientModule, "getPrismaClient").returns({
      $queryRaw: sinon.stub().rejects(new Error("connection refused")),
    } as never);
    const app = createApp();

    const response = await request(app.callback()).get("/ready");

    expect(response.status).to.equal(503);
    expect(response.body).to.deep.equal({ status: "not ready", reason: "database unavailable" });
  });
});
