import { Prisma } from "@generated/prisma/client";
import { logger } from "@observability/logger";
import { getPrismaClient } from "./prismaClient";

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  operation = "transaction"
): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await getPrismaClient().$transaction(fn);
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    logger.debug({ operation, duration: Math.round(durationSeconds * 1000) }, "database transaction finished");
  }
}
