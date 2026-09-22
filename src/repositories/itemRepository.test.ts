import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toMoney } from "../domain/money";
import { closePool } from "../infrastructure/db/pool";
import { resetTestDb } from "../../tests/helpers/db";
import * as itemRepository from "./itemRepository";

const NONEXISTENT_ITEM_ID = "00000000-0000-0000-0000-000000000000";

let itemId: string;

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("getItem", () => {
  it("retrieves the seeded item by id", async () => {
    const item = await itemRepository.getItem(itemId);
    expect(item).toEqual({ id: itemId, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 });
  });

  it("returns undefined for an unknown id", async () => {
    expect(await itemRepository.getItem(NONEXISTENT_ITEM_ID)).toBeUndefined();
  });
});

describe("getAllItems", () => {
  it("retrieves every item", async () => {
    const items = await itemRepository.getAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: itemId, name: "Standard Unit" });
  });
});

describe("createItem", () => {
  it("inserts a new item and returns it with a generated id", async () => {
    const item = await itemRepository.createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    expect(item.id).not.toBe(itemId);
    expect(item).toEqual({ id: item.id, name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });
  });

  it("makes the new item retrievable via getItem", async () => {
    const created = await itemRepository.createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    expect(await itemRepository.getItem(created.id)).toEqual(created);
  });

  it("makes getAllItems return both the seeded and the new item", async () => {
    await itemRepository.createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    const items = await itemRepository.getAllItems();
    expect(items).toHaveLength(2);
  });
});
