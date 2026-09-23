import { expect } from "chai";
import sinon from "sinon";
import { logger } from "@observability/logger";
import { closeDependencies } from "./closeDependencies";

function fakeLogger() {
  return Object.assign(Object.create(logger), {
    info: sinon.stub(),
    error: sinon.stub(),
    warn: sinon.stub(),
  }) as typeof logger;
}

describe("closeDependencies", () => {
  it("closes the database pool, then the cache client, in order", async () => {
    const callOrder: string[] = [];
    const closePool = sinon.stub().callsFake(async () => {
      callOrder.push("closePool");
    });
    const closeCache = sinon.stub().callsFake(async () => {
      callOrder.push("closeCache");
    });

    await closeDependencies({ closePool, closeCache, logger: fakeLogger() });

    expect(callOrder).to.deep.equal(["closePool", "closeCache"]);
  });

  it("skips closeCache entirely when it isn't provided", async () => {
    const closePool = sinon.stub().resolves(undefined);

    await closeDependencies({ closePool, logger: fakeLogger() });

    expect(closePool.calledOnce).to.equal(true);
  });

  it("still closes the cache client even if closePool rejects (logs the error instead of throwing)", async () => {
    const closePool = sinon.stub().rejects(new Error("pool already ending"));
    const closeCache = sinon.stub().resolves(undefined);
    const log = fakeLogger();

    await closeDependencies({ closePool, closeCache, logger: log });

    expect((log.error as sinon.SinonStub).calledOnce).to.equal(true);
    const [errArg, message] = (log.error as sinon.SinonStub).getCall(0).args;
    expect(errArg.err).to.be.instanceOf(Error);
    expect(message).to.equal("error while closing database pool");
    expect(closeCache.calledOnce).to.equal(true);
  });

  it("logs but does not throw when closeCache rejects", async () => {
    const closePool = sinon.stub().resolves(undefined);
    const closeCache = sinon.stub().rejects(new Error("redis already closed"));
    const log = fakeLogger();

    await closeDependencies({ closePool, closeCache, logger: log });

    expect((log.error as sinon.SinonStub).calledOnce).to.equal(true);
    const [errArg, message] = (log.error as sinon.SinonStub).getCall(0).args;
    expect(errArg.err).to.be.instanceOf(Error);
    expect(message).to.equal("error while closing cache client");
  });
});
