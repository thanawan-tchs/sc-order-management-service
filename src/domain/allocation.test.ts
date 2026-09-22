import { expect } from "chai";
import { allocateOrder, WarehouseCandidate } from "./allocation";
import { calculateShippingCost } from "./shipping";
import { pointAtDistanceFromOrigin } from "../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

const WEIGHT_KG = 1;
const RATE = 1;

function warehouseAtDistance(distanceKm: number, warehouseId: number, stock: number): WarehouseCandidate {
  const { latitude, longitude } = pointAtDistanceFromOrigin(distanceKm);
  return { warehouseId, latitude, longitude, stock };
}

describe("allocateOrder", () => {
  it("single warehouse: fulfills entirely from the one candidate", () => {
    const warehouse = warehouseAtDistance(50, 1, 1000);

    const result = allocateOrder(300, DESTINATION, [warehouse], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations).to.have.lengthOf(1);
    expect(result.allocations[0]).to.include({ warehouseId: 1, quantity: 300, shippingCostCents: 15000 });
    expect(result.allocations[0].distanceKm).to.be.closeTo(50, 1e-6);
    expect(result.totalShippingCostCents).to.equal(15000); // 50km * 300 * 1kg * 1c
  });

  it("two warehouses: drains the cheaper one first, then spills into the second", () => {
    const near = warehouseAtDistance(50, 1, 80);
    const far = warehouseAtDistance(150, 2, 500);

    const result = allocateOrder(100, DESTINATION, [far, near], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations).to.have.lengthOf(2);
    expect(result.allocations[0]).to.include({ warehouseId: 1, quantity: 80, shippingCostCents: 4000 });
    expect(result.allocations[0].distanceKm).to.be.closeTo(50, 1e-6);
    expect(result.allocations[1]).to.include({ warehouseId: 2, quantity: 20, shippingCostCents: 3000 });
    expect(result.allocations[1].distanceKm).to.be.closeTo(150, 1e-6);
    expect(result.totalShippingCostCents).to.equal(7000);
  });

  it("three warehouses: matches the ticket's own worked example (A=100, B=20, C=0)", () => {
    const a = warehouseAtDistance(100, 1, 100); // 100 cents/unit = $1
    const b = warehouseAtDistance(200, 2, 50); // 200 cents/unit = $2
    const c = warehouseAtDistance(300, 3, 200); // 300 cents/unit = $3

    const result = allocateOrder(120, DESTINATION, [c, a, b], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations).to.have.lengthOf(2);
    expect(result.allocations[0]).to.include({ warehouseId: 1, quantity: 100, shippingCostCents: 10000 });
    expect(result.allocations[0].distanceKm).to.be.closeTo(100, 1e-6);
    expect(result.allocations[1]).to.include({ warehouseId: 2, quantity: 20, shippingCostCents: 4000 });
    expect(result.allocations[1].distanceKm).to.be.closeTo(200, 1e-6);
    expect(result.allocations.find((line) => line.warehouseId === 3)).to.equal(undefined);
    expect(result.totalShippingCostCents).to.equal(14000); // $140.00
  });

  it("exact stock: fully drains every warehouse needed with nothing left over or short", () => {
    const a = warehouseAtDistance(10, 1, 100);
    const b = warehouseAtDistance(20, 2, 50);
    const untouchedButCheaperNever = warehouseAtDistance(30, 3, 999); // more expensive, unused

    const result = allocateOrder(150, DESTINATION, [a, b, untouchedButCheaperNever], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations.map((l) => ({ warehouseId: l.warehouseId, quantity: l.quantity }))).to.deep.equal([
      { warehouseId: 1, quantity: 100 },
      { warehouseId: 2, quantity: 50 },
    ]);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).to.equal(150);
  });

  it("insufficient stock: reports unfulfilled and allocates only what's available", () => {
    const a = warehouseAtDistance(10, 1, 30);
    const b = warehouseAtDistance(20, 2, 40);

    const result = allocateOrder(100, DESTINATION, [a, b], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(false);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).to.equal(70); // all available stock, short of the requested 100
    for (const line of result.allocations) {
      const warehouse = [a, b].find((w) => w.warehouseId === line.warehouseId)!;
      expect(line.quantity).to.be.at.most(warehouse.stock);
    }
  });

  it("insufficient stock: detects a total shortfall even with many warehouses", () => {
    const warehouses = [
      warehouseAtDistance(10, 1, 5),
      warehouseAtDistance(20, 2, 5),
      warehouseAtDistance(30, 3, 5),
    ];

    const result = allocateOrder(1000, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(false);
    expect(result.allocations.reduce((sum, l) => sum + l.quantity, 0)).to.equal(15);
  });

  it("equal shipping cost: ties are broken deterministically (ascending warehouseId)", () => {
    const sameDistance = 100;
    const lowerId = warehouseAtDistance(sameDistance, 1, 30);
    const higherId = warehouseAtDistance(sameDistance, 2, 40);

    const result = allocateOrder(50, DESTINATION, [higherId, lowerId], WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations).to.have.lengthOf(2);
    expect(result.allocations[0]).to.include({ warehouseId: 1, quantity: 30, shippingCostCents: 3000 });
    expect(result.allocations[0].distanceKm).to.be.closeTo(100, 1e-6);
    expect(result.allocations[1]).to.include({ warehouseId: 2, quantity: 20, shippingCostCents: 2000 });
    expect(result.allocations[1].distanceKm).to.be.closeTo(100, 1e-6);
  });

  it("large order: correctly spreads across many warehouses in cost order", () => {
    const warehouses = [10, 20, 30, 40, 50].map((distance, index) =>
      warehouseAtDistance(distance, index + 1, 30000)
    );

    const result = allocateOrder(100000, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations.map((l) => ({ warehouseId: l.warehouseId, quantity: l.quantity }))).to.deep.equal([
      { warehouseId: 1, quantity: 30000 },
      { warehouseId: 2, quantity: 30000 },
      { warehouseId: 3, quantity: 30000 },
      { warehouseId: 4, quantity: 10000 },
    ]);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).to.equal(100000);
  });

  it("never allocates more than a warehouse's stock, and never allocates to zero-stock warehouses", () => {
    const warehouses = [
      warehouseAtDistance(10, 1, 5),
      warehouseAtDistance(20, 2, 0),
      warehouseAtDistance(30, 3, 200),
    ];

    const result = allocateOrder(50, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).to.equal(true);
    expect(result.allocations.find((l) => l.warehouseId === 2)).to.equal(undefined);
    for (const line of result.allocations) {
      const warehouse = warehouses.find((w) => w.warehouseId === line.warehouseId)!;
      expect(line.quantity).to.be.at.most(warehouse.stock);
    }
  });

  it("total shipping cost equals the sum of each allocation's own (independently computed) cost", () => {
    const a = warehouseAtDistance(75, 1, 40);
    const b = warehouseAtDistance(225, 2, 40);

    const result = allocateOrder(60, DESTINATION, [a, b], 0.365, 1);

    const expectedTotal = result.allocations.reduce(
      (sum, line) => sum + calculateShippingCost(line.distanceKm, line.quantity, 0.365, 1),
      0
    );
    expect(result.totalShippingCostCents).to.equal(expectedTotal);
  });

  it("does not mutate the warehouses passed in", () => {
    const warehouses = [warehouseAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(warehouses));

    allocateOrder(50, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(warehouses).to.deep.equal(snapshot);
  });
});
