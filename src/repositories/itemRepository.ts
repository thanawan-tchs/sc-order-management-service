import { Currency, Money, toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import { QueryExecutor, getPool } from "@infrastructure/db/pool";

interface ItemRow {
  id: string;
  name: string;
  price: number;
  currency: Currency;
  weight_kg: number;
}

function mapItemRow(row: ItemRow): Item {
  return { id: row.id, name: row.name, price: toMoney(row.price), currency: row.currency, weightKg: row.weight_kg };
}

export async function getItem(id: string, executor: QueryExecutor = getPool()): Promise<Item | undefined> {
  const { rows } = await executor.query<ItemRow>(
    "SELECT id, name, price, currency, weight_kg FROM items WHERE id = $1",
    [id]
  );
  return rows[0] ? mapItemRow(rows[0]) : undefined;
}

export async function getAllItems(executor: QueryExecutor = getPool()): Promise<Item[]> {
  const { rows } = await executor.query<ItemRow>("SELECT id, name, price, currency, weight_kg FROM items ORDER BY id");
  return rows.map(mapItemRow);
}

export interface CreateItemInput {
  name: string;
  price: Money;
  currency: Currency;
  weightKg: number;
}

export async function createItem(
  input: CreateItemInput,
  executor: QueryExecutor = getPool()
): Promise<Item> {
  const { rows } = await executor.query<ItemRow>(
    "INSERT INTO items (name, price, currency, weight_kg) VALUES ($1, $2, $3, $4) RETURNING id, name, price, currency, weight_kg",
    [input.name, input.price, input.currency, input.weightKg]
  );
  return mapItemRow(rows[0]);
}
