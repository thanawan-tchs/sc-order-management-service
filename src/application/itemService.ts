import { Item } from "../domain/types";
import {
  CreateItemInput,
  createItem as createItemRow,
  getAllItems as getAllItemsRow,
  getItem as getItemRow,
} from "../repositories/itemRepository";

/**
 * Thin controller -> application service -> repository wrappers for the item catalog, same
 * layering as getOrderService.ts — no business logic here today, but keeps the controller from
 * talking to the repository directly and gives future concerns (authorization, cache
 * invalidation) a natural home.
 */
export async function createItem(input: CreateItemInput): Promise<Item> {
  return createItemRow(input);
}

export async function getItem(itemId: string): Promise<Item | undefined> {
  return getItemRow(itemId);
}

export async function getAllItems(): Promise<Item[]> {
  return getAllItemsRow();
}
