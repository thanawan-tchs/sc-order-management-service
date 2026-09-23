import { SEED_ITEMS, SEED_WAREHOUSES } from "@config";
import { PrismaClient } from "@generated/prisma/client";
import { getPrismaClient } from "./prismaClient";

export async function seed(): Promise<string> {
  const prisma = getPrismaClient();

  const itemId = await seedItems(prisma);
  await seedWarehouses(prisma, itemId);
  return itemId;
}

async function seedItems(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.item.findFirst({ orderBy: { id: "asc" } });
  if (existing) return existing.id;

  const [item] = SEED_ITEMS;
  const created = await prisma.item.create({
    data: { id: item.id, name: item.name, price: item.price, currency: item.currency, weightKg: item.weightKg },
  });
  return created.id;
}

async function seedWarehouses(prisma: PrismaClient, itemId: string): Promise<void> {
  const count = await prisma.warehouse.count();
  if (count > 0) return;

  for (const warehouse of SEED_WAREHOUSES) {
    const created = await prisma.warehouse.create({
      data: { name: warehouse.name, latitude: warehouse.latitude, longitude: warehouse.longitude },
    });
    await prisma.inventory.create({
      data: { warehouseId: created.id, itemId, stock: warehouse.stock },
    });
  }
}
