import Redis from "ioredis";
import { config } from "@config";
import { logger } from "@observability/logger";

let client: Redis | undefined;

export function getRedisClient(): Redis | undefined {
  if (!config.redisUrl) return undefined;

  if (!client) {
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    client.on("error", (err) => logger.warn({ err }, "redis client error"));
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
