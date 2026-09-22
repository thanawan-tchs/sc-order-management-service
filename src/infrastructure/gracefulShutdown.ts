import { Server } from "http";
import { logger as defaultLogger } from "@observability/logger";

export interface GracefulShutdownDependencies {
  server: Pick<Server, "close">;
  closePool: () => Promise<void>;
  closeCache?: () => Promise<void>;
  exit: (code: number) => void;
  logger: typeof defaultLogger;
  timeoutMs: number;
}

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

    if (deps.closeCache) {
      try {
        await deps.closeCache();
      } catch (err) {
        deps.logger.error({ err }, "error while closing cache client");
      }
    }

    clearTimeout(forceExitTimer);
    deps.exit(0);
  };
}
