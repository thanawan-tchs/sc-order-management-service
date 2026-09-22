import { expect } from "chai";
import sinon from "sinon";
import { getOrderQuote } from "./orderQuoteService";
import { WarehouseCandidate } from "@domain/allocation";
import exception from "@domain/errors";
import { toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import itemRepository from "@repositories/itemRepository";
import warehouseRepository from "@repositories/warehouseRepository";
import { pointAtDistanceFromOrigin } from "@tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

const UNIT_WEIGHT_KG = 0.365;
const TEST_ITEM_ID = "test-item-id";
const TEST_ITEM: Item = {
  id: TEST_ITEM_ID,
  name: "Standard Unit",
  price: toMoney(15000),
  currency: "USD",
  weightKg: UNIT_WEIGHT_KG,
};

function candidateAtDistance(distanceKm: number, warehouseId: number, stock: number): WarehouseCandidate {
  const { latitude, longitude } = pointAtDistanceFromOrigin(distanceKm);
  return { warehouseId, latitude, longitude, stock };
}

function stubCandidates(candidates: WarehouseCandidate[], item: Item = TEST_ITEM): void {
  sinon.stub(itemRepository, "getItem").resolves(item);
  sinon.stub(warehouseRepository, "getAllWarehouses").resolves(
    candidates.map((candidate) => ({
      id: candidate.warehouseId,
      name: `Warehouse ${candidate.warehouseId}`,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    }))
  );
  sinon.stub(warehouseRepository, "getInventory").callsFake(async (warehouseId: number, itemId: string) => {
    const candidate = candidates.find((c) => c.warehouseId === warehouseId);
    return candidate ? { warehouseId, itemId, stock: candidate.stock } : undefined;
  });
}

afterEach(() => {
  sinon.restore();
});

describe("getOrderQuote", () => {
  it("returns a valid quote for a straightforward single-warehouse order", async () => {
    stubCandidates([candidateAtDistance(50, 1, 100)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 10, shippingAddress: DESTINATION });

    expect(quote.quantity).to.equal(10);
    expect(quote.item).to.deep.equal(TEST_ITEM);
    expect(quote.subtotal).to.equal(150000);
    expect(quote.discountRate).to.equal(0);
    expect(quote.discount).to.equal(0);
    expect(quote.amountAfterDiscount).to.equal(150000);
    expect(quote.totalWeightKg).to.be.closeTo(10 * UNIT_WEIGHT_KG, 1e-10);
    expect(quote.shippingCost).to.equal(183);
    expect(quote.total).to.equal(150000 + 183);
    expect(quote.allocations).to.have.lengthOf(1);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("throws ItemNotFoundError for an unknown itemId, without reading inventory", async () => {
    sinon.stub(itemRepository, "getItem").resolves(undefined);
    const getAllWarehousesStub = sinon.stub(warehouseRepository, "getAllWarehouses").resolves([]);

    await expect(
      getOrderQuote({ itemId: "unknown-item-id", quantity: 10, shippingAddress: DESTINATION })
    ).to.be.rejectedWith(exception.ItemNotFoundError);
    expect(getAllWarehousesStub.called).to.equal(false);
  });

  it("applies the correct discount rate across tier boundaries", async () => {
    stubCandidates([candidateAtDistance(1, 1, 1000)]);

    const below = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 24, shippingAddress: DESTINATION });
    const at25 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 25, shippingAddress: DESTINATION });
    const below250 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 249, shippingAddress: DESTINATION });
    const at250 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 250, shippingAddress: DESTINATION });

    expect(below.discountRate).to.equal(0);
    expect(below.discount).to.equal(0);

    expect(at25.discountRate).to.equal(0.05);
    expect(at25.subtotal).to.equal(375000);
    expect(at25.discount).to.equal(18750);
    expect(at25.amountAfterDiscount).to.equal(356250);

    expect(below250.discountRate).to.equal(0.15);

    expect(at250.discountRate).to.equal(0.2);
    expect(at250.subtotal).to.equal(3750000);
    expect(at250.discount).to.equal(750000);
    expect(at250.amountAfterDiscount).to.equal(3000000);

    for (const quote of [below, at25, below250, at250]) {
      expect(quote.valid).to.equal(true);
    }
  });

  it("splits a multi-warehouse order across the cheapest warehouses first", async () => {
    const warehouseA = candidateAtDistance(100, 1, 50);
    const warehouseB = candidateAtDistance(200, 2, 50);
    stubCandidates([warehouseB, warehouseA]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 80, shippingAddress: DESTINATION });

    expect(quote.allocations).to.have.lengthOf(2);
    expect(quote.allocations[0]).to.include({ warehouseId: 1, quantity: 50, shippingCost: 1825 });
    expect(quote.allocations[1]).to.include({ warehouseId: 2, quantity: 30, shippingCost: 2190 });
    expect(quote.shippingCost).to.equal(4015);
    expect(quote.discountRate).to.equal(0.1);
    expect(quote.valid).to.equal(true);
  });

  it("flags insufficient stock as invalid, while still returning the partial allocation", async () => {
    stubCandidates([candidateAtDistance(10, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 50, shippingAddress: DESTINATION });

    expect(quote.valid).to.equal(false);
    expect(quote.invalidReasons).to.deep.equal(["INSUFFICIENT_STOCK"]);
    expect(quote.allocations).to.have.lengthOf(1);
    expect(quote.allocations[0]).to.include({ warehouseId: 1, quantity: 10 });
    expect(quote.subtotal).to.equal(50 * 15000);
  });

  it("flags shipping cost exceeding 15% of the discounted amount as invalid", async () => {
    stubCandidates([candidateAtDistance(10000, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION });

    expect(quote.amountAfterDiscount).to.equal(15000);
    expect(quote.shippingCost).to.equal(3650);
    expect(quote.valid).to.equal(false);
    expect(quote.invalidReasons).to.deep.equal(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
  });

  it("treats shipping cost exactly at 15% as valid (inclusive boundary)", async () => {
    const distanceForExactly2250Cents = 2250 / (1 * UNIT_WEIGHT_KG);
    stubCandidates([candidateAtDistance(distanceForExactly2250Cents, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION });

    expect(quote.amountAfterDiscount).to.equal(15000);
    expect(quote.shippingCost).to.equal(2250);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("treats shipping cost below 15% as valid", async () => {
    stubCandidates([candidateAtDistance(20, 1, 50)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 5, shippingAddress: DESTINATION });

    expect(quote.shippingCost).to.equal(37);
    expect(quote.shippingCost).to.be.lessThan(11250);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("never creates an order, changes inventory, or reserves stock", async () => {
    const candidates = [candidateAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    stubCandidates(candidates);

    await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 20, shippingAddress: DESTINATION });

    expect(candidates).to.deep.equal(snapshot);
  });
});
