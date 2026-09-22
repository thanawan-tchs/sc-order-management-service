import { Item } from "../../domain/model/item";
import * as itemRepository from "../../repositories/itemRepository";

export async function createItem(input: itemRepository.CreateItemInput): Promise<Item> {
  return itemRepository.createItem(input);
}

export async function getItem(itemId: string): Promise<Item | undefined> {
  return itemRepository.getItem(itemId);
}

export async function getAllItems(): Promise<Item[]> {
  return itemRepository.getAllItems();
}
