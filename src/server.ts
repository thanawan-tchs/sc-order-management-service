import gracefulShutdown from "http-graceful-shutdown";
import { createApp } from "./app";
import { config } from "./config";
import { closeRedisClient, connectRedisClient } from "./infrastructure/cache/redisClient";
import { closeDependencies } from "./infrastructure/closeDependencies";
import { migrate } from "./infrastructure/db/migrate";
import { closePrisma, connectPrisma } from "./infrastructure/db/prismaClient";
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

  gracefulShutdown(server, {
    timeout: config.shutdownTimeoutMs,
    onShutdown: () => closeDependencies({ closePool: closePrisma, closeCache: closeRedisClient, logger }),
    finally: (signal) => logger.info({ signal }, "shutting down"),
  });
}

main().catch((error) => {
  logger.error({ err: error }, "failed to start order-management-service");
  process.exit(1);
});
