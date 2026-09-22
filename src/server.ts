import { createApp } from "./app";
import { config } from "./config";
import { closeRedisClient, connectRedisClient } from "./infrastructure/cache/redisClient";
import { migrate } from "./infrastructure/db/migrate";
import { closePrisma, connectPrisma } from "./infrastructure/db/prismaClient";
import { createShutdownHandler } from "./infrastructure/gracefulShutdown";
import { logger } from "./observability/logger";

async function main(): Promise<void> {
  await migrate();
  await connectPrisma();
  await connectRedisClient();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "order-management-service listening");
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;

  const shutdown = createShutdownHandler({
    server,
    closePool: closePrisma,
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
