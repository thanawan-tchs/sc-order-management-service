import { Server } from "http";
import { logger as defaultLogger } from "../observability/logger";

export interface GracefulShutdownDependencies {
  server: Pick<Server, "close">;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  logger: typeof defaultLogger;
  timeoutMs: number;
}

/**
 * Ticket 17: on SIGTERM/SIGINT, stop accepting new HTTP connections (letting in-flight ones
 * finish — `http.Server#close`'s normal behavior), close the database pool, then exit. Forces
 * exit after `timeoutMs` if something hangs (a connection that never finishes, a pool that never
 * closes), so the process doesn't sit alive-but-unresponsive forever.
 *
 * Everything the shutdown sequence touches is a dependency, not a direct call to `process.exit`
 * or the real pool — that's what makes this testable without actually killing a process or
 * standing up a real server (see server.ts for the real wiring).
 */
export function createShutdownHandler(deps: GracefulShutdownDependencies): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.logger.info({ signal }, "shutting down");

    const forceExitTimer = setTimeout(() => {
      deps.logger.error("graceful shutdown timed out, forcing exit");
      deps.exit(1);
    }, deps.timeoutMs);
    forceExitTimer.unref();

    await new Promise<void>((resolve) => {
      deps.server.close((err) => {
        if (err) deps.logger.error({ err }, "error while closing http server");
        resolve();
      });
    });

    try {
      await deps.closePool();
    } catch (err) {
      deps.logger.error({ err }, "error while closing database pool");
    }

    clearTimeout(forceExitTimer);
    deps.exit(0);
  };
}
