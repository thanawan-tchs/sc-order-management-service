import { logger as defaultLogger } from "@observability/logger";

export interface CloseDependenciesInput {
  closePool: () => Promise<void>;
  closeCache?: () => Promise<void>;
  logger: typeof defaultLogger;
}

export async function closeDependencies(deps: CloseDependenciesInput): Promise<void> {
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
}
