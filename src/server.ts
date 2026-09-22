import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "./app";
import { config } from "./config";
import { closeRedisClient, connectRedisClient } from "./infrastructure/cache/redisClient";
import { closePrisma, connectPrisma } from "./infrastructure/db/prismaClient";
import { seed } from "./infrastructure/db/seed";
import { createShutdownHandler } from "./infrastructure/gracefulShutdown";
import { logger } from "./observability/logger";

const execFileAsync = promisify(execFile);

async function migrate(): Promise<void> {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], { env: process.env });
}

async function main(): Promise<void> {
  await migrate();
  await connectPrisma();
  await connectRedisClient();

  await seed();

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
