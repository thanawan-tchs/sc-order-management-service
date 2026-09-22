import { expect } from "chai";
import sinon from "sinon";
import { toMoney } from "../domain/money";
import { QueryExecutor } from "../infrastructure/db/pool";
import * as itemRepository from "./itemRepository";

function fakeExecutor(query: sinon.SinonStub): QueryExecutor {
  return { query } as unknown as QueryExecutor;
}

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_ROW = { id: ITEM_ID, name: "Standard Unit", price_cents: 15000, weight_kg: 0.365 };

describe("getItem", () => {
  it("retrieves an item by id, mapping snake_case columns to the domain Item shape", async () => {
    const query = sinon.stub().resolves({ rows: [ITEM_ROW], rowCount: 1 });

    const item = await itemRepository.getItem(ITEM_ID, fakeExecutor(query));

    expect(query.calledWith("SELECT id, name, price_cents, weight_kg FROM items WHERE id = $1", [ITEM_ID])).to.equal(
      true
    );
    expect(item).to.deep.equal({ id: ITEM_ID, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 });
  });

  it("returns undefined when no row matches", async () => {
    const query = sinon.stub().resolves({ rows: [], rowCount: 0 });

    expect(await itemRepository.getItem("unknown-id", fakeExecutor(query))).to.equal(undefined);
  });
});

describe("getAllItems", () => {
  it("retrieves and maps every item row", async () => {
    const query = sinon.stub().resolves({ rows: [ITEM_ROW], rowCount: 1 });

    const items = await itemRepository.getAllItems(fakeExecutor(query));

    expect(query.calledWith("SELECT id, name, price_cents, weight_kg FROM items ORDER BY id")).to.equal(true);
    expect(items).to.have.lengthOf(1);
    expect(items[0]).to.deep.equal({ id: ITEM_ID, name: "Standard Unit", priceCents: 15000, weightKg: 0.365 });
  });
});

describe("createItem", () => {
  it("inserts a new item and returns the row it gets back, mapped to the domain shape", async () => {
    const insertedRow = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Deluxe Unit",
      price_cents: 25000,
      weight_kg: 1.2,
    };
    const query = sinon.stub().resolves({ rows: [insertedRow], rowCount: 1 });

    const item = await itemRepository.createItem(
      { name: "Deluxe Unit", priceCents: toMoney(25000), weightKg: 1.2 },
      fakeExecutor(query)
    );

    expect(
      query.calledWith(
        "INSERT INTO items (name, price_cents, weight_kg) VALUES ($1, $2, $3) RETURNING id, name, price_cents, weight_kg",
        ["Deluxe Unit", 25000, 1.2]
      )
    ).to.equal(true);
    expect(item).to.deep.equal({ id: insertedRow.id, name: "Deluxe Unit", priceCents: 25000, weightKg: 1.2 });
  });
});
