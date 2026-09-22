import { logger } from "@observability/logger";
import { getRedisClient } from "./redisClient";

export async function readThrough<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const client = getRedisClient();
  if (!client) return load();

  try {
    const cached = await client.get(key);
    if (cached !== null) return JSON.parse(cached) as T;
  } catch (err) {
    logger.warn({ err, key }, "cache read failed, falling back to source");
  }

  const value = await load();

  if (value !== undefined) {
    client.set(key, JSON.stringify(value), "EX", ttlSeconds).catch((err) => {
      logger.warn({ err, key }, "cache write failed");
    });
  }

  return value;
}
