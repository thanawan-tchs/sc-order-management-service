import { Server } from "http";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../observability/logger";
import { createShutdownHandler } from "./gracefulShutdown";

function fakeLogger() {
  return Object.assign(Object.create(logger), { info: vi.fn(), error: vi.fn(), warn: vi.fn() }) as typeof logger;
}

/** A minimal fake satisfying `Pick<Server, "close">` — real `http.Server#close` returns `this`
 *  for chaining, which these one-off test doubles have no need to fake beyond the type cast. */
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
    const closePool = vi.fn(async () => {
      callOrder.push("closePool");
    });
    const exit = vi.fn((code: number) => {
      callOrder.push(`exit(${code})`);
    });

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect(callOrder).toEqual(["server.close", "closePool", "exit(0)"]);
  });

  it("only runs once, even if called multiple times (e.g. SIGTERM then SIGINT)", async () => {
    const closePool = vi.fn(async () => undefined);
    const exit = vi.fn();
    const server = fakeServer((cb) => cb());

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 5000 });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(closePool).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("still closes the pool and exits(0) even if server.close reports an error", async () => {
    const closePool = vi.fn(async () => undefined);
    const exit = vi.fn();
    const server = fakeServer((cb) => cb(new Error("already closing")));
    const log = fakeLogger();

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: log, timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "error while closing http server"
    );
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still exits(0) even if closePool rejects (logs the error instead of hanging)", async () => {
    const closePool = vi.fn(async () => {
      throw new Error("pool already ending");
    });
    const exit = vi.fn();
    const server = fakeServer((cb) => cb());
    const log = fakeLogger();

    const shutdown = createShutdownHandler({ server, closePool, exit, logger: log, timeoutMs: 5000 });
    await shutdown("SIGTERM");

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "error while closing database pool"
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("force-exits with code 1 if shutdown takes longer than the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const closePool = vi.fn(() => new Promise<void>(() => undefined)); // never resolves
      const exit = vi.fn();
      const server = fakeServer(() => undefined); // never calls back

      const shutdown = createShutdownHandler({ server, closePool, exit, logger: fakeLogger(), timeoutMs: 1000 });
      const shutdownPromise = shutdown("SIGTERM");

      await vi.advanceTimersByTimeAsync(1000);

      expect(exit).toHaveBeenCalledWith(1);
      // Prevent an unhandled-rejection/dangling-promise warning; this promise never resolves in
      // this scenario by design (server.close never calls back), which is fine — the force-exit
      // path is what's under test here, not the promise settling.
      void shutdownPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
