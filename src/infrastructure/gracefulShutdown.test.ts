import { Server } from "http";
import { expect } from "chai";
import sinon from "sinon";
import { logger } from "../observability/logger";
import { createShutdownHandler } from "./gracefulShutdown";

function fakeLogger() {
  return Object.assign(Object.create(logger), {
    info: sinon.stub(),
    error: sinon.stub(),
    warn: sinon.stub(),
  }) as typeof logger;
}

function fakeServer(close: (cb: (err?: Error) => void) => void): Pick<Server, "close"> {
  return { close } as unknown as Pick<Server, "close">;
}

describe("createShutdownHandler", () => {
  it("closes the HTTP server, then the database pool, then exits with code 0", async () => {
    const callOrder: string[] = [];
    const server = fakeServer((cb) => {
      callOrder.push("server.close");
      cb();
    });
    const closePool = sinon.stub().callsFake(async () => {
      callOrder.push("closePool");
    });
    const exit = sinon.stub().callsFake((code: number) => {
      callOrder.push(`exit(${code})`);
    });

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect(callOrder).to.deep.equal(["server.close", "closePool", "exit(0)"]);
  });

  it("only runs once, even if called multiple times (e.g. SIGTERM then SIGINT)", async () => {
    const closePool = sinon.stub().resolves(undefined);
    const exit = sinon.stub();
    const server = fakeServer((cb) => cb());

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 5000 });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(closePool.callCount).to.equal(1);
    expect(exit.callCount).to.equal(1);
  });

  it("still closes the pool and exits(0) even if server.close reports an error", async () => {
    const closePool = sinon.stub().resolves(undefined);
    const exit = sinon.stub();
    const server = fakeServer((cb) => cb(new Error("already closing")));
    const log = fakeLogger();

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: log, timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect((log.error as sinon.SinonStub).calledOnce).to.equal(true);
    const [errArg, message] = (log.error as sinon.SinonStub).getCall(0).args;
    expect(errArg.err).to.be.instanceOf(Error);
    expect(message).to.equal("error while closing http server");
    expect(closePool.callCount).to.equal(1);
    expect(exit.calledWith(0)).to.equal(true);
  });

  it("still exits(0) even if closePool rejects (logs the error instead of hanging)", async () => {
    const closePool = sinon.stub().rejects(new Error("pool already ending"));
    const exit = sinon.stub();
    const server = fakeServer((cb) => cb());
    const log = fakeLogger();

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: log, timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect((log.error as sinon.SinonStub).calledOnce).to.equal(true);
    const [errArg, message] = (log.error as sinon.SinonStub).getCall(0).args;
    expect(errArg.err).to.be.instanceOf(Error);
    expect(message).to.equal("error while closing database pool");
    expect(exit.calledWith(0)).to.equal(true);
  });

  it("force-exits with code 1 if shutdown takes longer than the configured timeout", async () => {
    const clock = sinon.useFakeTimers();
    try {
      const closePool = sinon.stub().returns(new Promise<void>(() => undefined)); // never resolves
      const exit = sinon.stub();
      const server = fakeServer(() => undefined); // never calls back

      const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 1000 });
      const shutdownPromise = shutdown("SIGTERM");

      await clock.tickAsync(1000);

      expect(exit.calledWith(1)).to.equal(true);
      void shutdownPromise;
    } finally {
      clock.restore();
    }
  });
});
