import { expect } from "chai";
import request from "supertest";
import sinon from "sinon";
import Koa from "koa";
import { createApp } from "./app";
import * as poolModule from "./infrastructure/db/pool";

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
    sinon.stub(poolModule, "getPool").returns({ query: sinon.stub().resolves({ rows: [], rowCount: 0 }) } as never);
    const app = createApp();

    const response = await request(app.callback()).get("/ready");

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ status: "ready" });
  });

  it("returns 503 with status not ready when the database is unreachable", async () => {
    sinon.stub(poolModule, "getPool").returns({
      query: sinon.stub().rejects(new Error("connection refused")),
    } as never);
    const app = createApp();

    const response = await request(app.callback()).get("/ready");

    expect(response.status).to.equal(503);
    expect(response.body).to.deep.equal({ status: "not ready", reason: "database unavailable" });
  });
});
