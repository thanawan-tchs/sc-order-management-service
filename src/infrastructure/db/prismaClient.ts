import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "@config";
import { PrismaClient, Prisma } from "@generated/prisma/client";
import { logger } from "../../observability/logger";

export type QueryExecutor = PrismaClient | Prisma.TransactionClient;

export function buildPoolConfig(): PrismaPgConfig {
  return {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: config.dbIdleTimeoutMs,
    connectionTimeoutMillis: config.dbConnectionTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
  };
}

interface PrismaPgConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
}

let client: PrismaClient | undefined;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(buildPoolConfig());
  return new PrismaClient({ adapter });
}

export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = createPrismaClient();
  }
  return client;
}

export async function connectPrisma(): Promise<void> {
  await getPrismaClient().$queryRaw`SELECT 1`;
  logger.info("connected to database");
}

export async function closePrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
