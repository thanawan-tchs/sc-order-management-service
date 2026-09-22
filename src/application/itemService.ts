import { Item } from "../domain/types";
import * as itemRepository from "../repositories/itemRepository";

/**
 * Thin controller -> application service -> repository wrappers for the item catalog, same
 * layering as getOrderService.ts — no business logic here today, but keeps the controller from
 * talking to the repository directly and gives future concerns (authorization, cache
 * invalidation) a natural home.
 */
export async function createItem(input: itemRepository.CreateItemInput): Promise<Item> {
  return itemRepository.createItem(input);
}

export async function getItem(itemId: string): Promise<Item | undefined> {
  return itemRepository.getItem(itemId);
}

export async function getAllItems(): Promise<Item[]> {
  return itemRepository.getAllItems();
}
