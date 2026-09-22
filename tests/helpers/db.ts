import { getPrismaClient } from "@infrastructure/db/prismaClient";
import { seed } from "@infrastructure/db/seed";

export async function resetTestDb(): Promise<string> {
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    "TRUNCATE idempotency_keys, order_allocations, orders, inventory, warehouses, items RESTART IDENTITY CASCADE"
  );
  await prisma.$executeRawUnsafe("ALTER SEQUENCE order_number_seq RESTART WITH 1");
  return seed();
}
