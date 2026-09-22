import { config } from "@config";
import { Currency, Money, toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import { Item as ItemRecord } from "@generated/prisma/client";
import { QueryExecutor, getPrismaClient } from "@infrastructure/db/prismaClient";
import { readThrough } from "@infrastructure/cache/cache";

function mapItem(record: ItemRecord): Item {
  return {
    id: record.id,
    name: record.name,
    price: toMoney(record.price),
    currency: record.currency as Currency,
    weightKg: record.weightKg,
  };
}

export async function getItem(id: string, executor: QueryExecutor = getPrismaClient()): Promise<Item | undefined> {
  return readThrough(`item:${id}`, config.cacheTtlSeconds, async () => {
    const record = await executor.item.findUnique({ where: { id } });
    return record ? mapItem(record) : undefined;
  });
}

export async function getAllItems(executor: QueryExecutor = getPrismaClient()): Promise<Item[]> {
  const records = await executor.item.findMany({ orderBy: { id: "asc" } });
  return records.map(mapItem);
}

export interface CreateItemInput {
  name: string;
  price: Money;
  currency: Currency;
  weightKg: number;
}

export async function createItem(input: CreateItemInput, executor: QueryExecutor = getPrismaClient()): Promise<Item> {
  const record = await executor.item.create({
    data: { name: input.name, price: input.price, currency: input.currency, weightKg: input.weightKg },
  });
  return mapItem(record);
}

export default { getItem, getAllItems, createItem };
