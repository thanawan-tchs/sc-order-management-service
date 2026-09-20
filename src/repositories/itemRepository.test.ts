import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { toMoney } from "../domain/money";
import { closePool } from "../infrastructure/db/pool";
import { resetTestDb } from "../../tests/helpers/db";
import { createItem, getAllItems, getItem } from "./itemRepository";

// A syntactically valid UUID that will never match a real row — used to test the "not found"
// path. A malformed string (e.g. "999") would fail at the SQL level (invalid input syntax for
// type uuid) rather than exercising the "no matching row" case this is actually testing.
const NONEXISTENT_ITEM_ID = "00000000-0000-0000-0000-000000000000";

// items is truncated + reseeded fresh by resetTestDb (RESTART IDENTITY), same as warehouses — but
// its id is a UUID (ticket "use item id as uuid format"), generated fresh on every reset, so it's
// captured here rather than hardcoded.
let itemId: string;

beforeEach(async () => {
  itemId = await resetTestDb();
});

afterAll(async () => {
  await closePool();
});

describe("getItem", () => {
  it("retrieves the seeded item by id", async () => {
    const item = await getItem(itemId);
    expect(item).toEqual({ id: itemId, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 });
  });

  it("returns undefined for an unknown id", async () => {
    expect(await getItem(NONEXISTENT_ITEM_ID)).toBeUndefined();
  });
});

describe("getAllItems", () => {
  it("retrieves every item", async () => {
    const items = await getAllItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: itemId, name: "Standard Unit" });
  });
});

describe("createItem", () => {
  it("inserts a new item and returns it with a generated id", async () => {
    const item = await createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    expect(item.id).not.toBe(itemId);
    expect(item).toEqual({ id: item.id, name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });
  });

  it("makes the new item retrievable via getItem", async () => {
    const created = await createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    expect(await getItem(created.id)).toEqual(created);
  });

  it("makes getAllItems return both the seeded and the new item", async () => {
    await createItem({ name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 });

    const items = await getAllItems();
    expect(items).toHaveLength(2);
  });
});
