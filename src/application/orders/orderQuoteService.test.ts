import { expect } from "chai";
import { getOrderQuote, OrderQuoteDependencies } from "./orderQuoteService";
import { WarehouseCandidate } from "../../domain/allocation";
import { ItemNotFoundError } from "../../domain/errors";
import { toMoney } from "../../domain/money";
import { Item } from "../../domain/model/item";
import { pointAtDistanceFromOrigin } from "../../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

const UNIT_WEIGHT_KG = 0.365;
const TEST_ITEM_ID = "test-item-id";
const TEST_ITEM: Item = { id: TEST_ITEM_ID, name: "Standard Unit", priceCents: toMoney(15000), weightKg: UNIT_WEIGHT_KG };

function candidateAtDistance(distanceKm: number, warehouseId: number, stock: number): WarehouseCandidate {
  const { latitude, longitude } = pointAtDistanceFromOrigin(distanceKm);
  return { warehouseId, latitude, longitude, stock };
}

function withCandidates(candidates: WarehouseCandidate[], item: Item = TEST_ITEM): OrderQuoteDependencies {
  return {
    readWarehouseCandidates: async () => candidates,
    getItem: async () => item,
  };
}

describe("getOrderQuote", () => {
  it("returns a valid quote for a straightforward single-warehouse order", async () => {
    const deps = withCandidates([candidateAtDistance(50, 1, 100)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 10, shippingAddress: DESTINATION }, deps);

    expect(quote.quantity).to.equal(10);
    expect(quote.item).to.deep.equal(TEST_ITEM);
    expect(quote.subtotalCents).to.equal(150000);
    expect(quote.discountRate).to.equal(0);
    expect(quote.discountCents).to.equal(0);
    expect(quote.amountAfterDiscountCents).to.equal(150000);
    expect(quote.totalWeightKg).to.be.closeTo(10 * UNIT_WEIGHT_KG, 1e-10);
    expect(quote.shippingCostCents).to.equal(183);
    expect(quote.totalCents).to.equal(150000 + 183);
    expect(quote.allocations).to.have.lengthOf(1);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("throws ItemNotFoundError for an unknown itemId, without reading inventory", async () => {
    let readCandidatesCalled = false;
    const deps: OrderQuoteDependencies = {
      readWarehouseCandidates: async () => {
        readCandidatesCalled = true;
        return [];
      },
      getItem: async () => undefined,
    };

    await expect(
      getOrderQuote({ itemId: "unknown-item-id", quantity: 10, shippingAddress: DESTINATION }, deps)
    ).to.be.rejectedWith(ItemNotFoundError);
    expect(readCandidatesCalled).to.equal(false);
  });

  it("applies the correct discount rate across tier boundaries", async () => {
    const deps = withCandidates([candidateAtDistance(1, 1, 1000)]);

    const below = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 24, shippingAddress: DESTINATION }, deps);
    const at25 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 25, shippingAddress: DESTINATION }, deps);
    const below250 = await getOrderQuote(
      { itemId: TEST_ITEM_ID, quantity: 249, shippingAddress: DESTINATION },
      deps
    );
    const at250 = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 250, shippingAddress: DESTINATION }, deps);

    expect(below.discountRate).to.equal(0);
    expect(below.discountCents).to.equal(0);

    expect(at25.discountRate).to.equal(0.05);
    expect(at25.subtotalCents).to.equal(375000);
    expect(at25.discountCents).to.equal(18750);
    expect(at25.amountAfterDiscountCents).to.equal(356250);

    expect(below250.discountRate).to.equal(0.15);

    expect(at250.discountRate).to.equal(0.2);
    expect(at250.subtotalCents).to.equal(3750000);
    expect(at250.discountCents).to.equal(750000);
    expect(at250.amountAfterDiscountCents).to.equal(3000000);

    for (const quote of [below, at25, below250, at250]) {
      expect(quote.valid).to.equal(true);
    }
  });

  it("splits a multi-warehouse order across the cheapest warehouses first", async () => {
    const warehouseA = candidateAtDistance(100, 1, 50);
    const warehouseB = candidateAtDistance(200, 2, 50);
    const deps = withCandidates([warehouseB, warehouseA]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 80, shippingAddress: DESTINATION }, deps);

    expect(quote.allocations).to.have.lengthOf(2);
    expect(quote.allocations[0]).to.include({ warehouseId: 1, quantity: 50, shippingCostCents: 1825 });
    expect(quote.allocations[1]).to.include({ warehouseId: 2, quantity: 30, shippingCostCents: 2190 });
    expect(quote.shippingCostCents).to.equal(4015);
    expect(quote.discountRate).to.equal(0.1);
    expect(quote.valid).to.equal(true);
  });

  it("flags insufficient stock as invalid, while still returning the partial allocation", async () => {
    const deps = withCandidates([candidateAtDistance(10, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 50, shippingAddress: DESTINATION }, deps);

    expect(quote.valid).to.equal(false);
    expect(quote.invalidReasons).to.deep.equal(["INSUFFICIENT_STOCK"]);
    expect(quote.allocations).to.have.lengthOf(1);
    expect(quote.allocations[0]).to.include({ warehouseId: 1, quantity: 10 });
    expect(quote.subtotalCents).to.equal(50 * 15000);
  });

  it("flags shipping cost exceeding 15% of the discounted amount as invalid", async () => {
    const deps = withCandidates([candidateAtDistance(10000, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).to.equal(15000);
    expect(quote.shippingCostCents).to.equal(3650);
    expect(quote.valid).to.equal(false);
    expect(quote.invalidReasons).to.deep.equal(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
  });

  it("treats shipping cost exactly at 15% as valid (inclusive boundary)", async () => {
    const distanceForExactly2250Cents = 2250 / (1 * UNIT_WEIGHT_KG);
    const deps = withCandidates([candidateAtDistance(distanceForExactly2250Cents, 1, 10)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 1, shippingAddress: DESTINATION }, deps);

    expect(quote.amountAfterDiscountCents).to.equal(15000);
    expect(quote.shippingCostCents).to.equal(2250);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("treats shipping cost below 15% as valid", async () => {
    const deps = withCandidates([candidateAtDistance(20, 1, 50)]);

    const quote = await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 5, shippingAddress: DESTINATION }, deps);

    expect(quote.shippingCostCents).to.equal(37);
    expect(quote.shippingCostCents).to.be.lessThan(11250);
    expect(quote.valid).to.equal(true);
    expect(quote.invalidReasons).to.deep.equal([]);
  });

  it("never creates an order, changes inventory, or reserves stock", async () => {
    const candidates = [candidateAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(candidates));
    const deps = withCandidates(candidates);

    await getOrderQuote({ itemId: TEST_ITEM_ID, quantity: 20, shippingAddress: DESTINATION }, deps);

    expect(candidates).to.deep.equal(snapshot);
  });
});
