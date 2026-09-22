import { createApp } from "./app";
import { config } from "./config";
import { closeRedisClient, connectRedisClient } from "./infrastructure/cache/redisClient";
import { closePool, connectPool } from "./infrastructure/db/pool";
import { migrate } from "./infrastructure/db/migrate";
import { seed } from "./infrastructure/db/seed";
import { createShutdownHandler } from "./infrastructure/gracefulShutdown";
import { logger } from "./observability/logger";

async function main(): Promise<void> {
  await connectPool();
  await connectRedisClient();

  // TODO: fix me 
  await migrate();
  await seed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "order-management-service listening");
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;

  const shutdown = createShutdownHandler({
    server,
    closePool,
    closeCache: closeRedisClient,
    exit: (code) => process.exit(code),
    logger,
    timeoutMs: config.shutdownTimeoutMs,
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start order-management-service");
  process.exit(1);
});
