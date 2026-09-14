import { describe, expect, it } from "vitest";
import { allocateOrder, WarehouseCandidate } from "../../src/domain/allocation";
import { calculateShippingCost } from "../../src/domain/shipping";
import { pointAtDistanceFromOrigin } from "../helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };

// unitWeightKg = 1, rate = 1 cent/kg/km throughout, so cost-per-unit (in cents) == distanceKm
// exactly — lets every expected number below be hand-computed rather than re-derived from the
// code under test.
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

    expect(result.fulfilled).toBe(true);
    expect(result.allocations).toEqual([
      {
        warehouseId: 1,
        quantity: 300,
        distanceKm: expect.closeTo(50, 6),
        shippingCostCents: 15000,
      },
    ]);
    expect(result.totalShippingCostCents).toBe(15000); // 50km * 300 * 1kg * 1c
  });

  it("two warehouses: drains the cheaper one first, then spills into the second", () => {
    const near = warehouseAtDistance(50, 1, 80);
    const far = warehouseAtDistance(150, 2, 500);

    const result = allocateOrder(100, DESTINATION, [far, near], WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations).toEqual([
      {
        warehouseId: 1,
        quantity: 80,
        distanceKm: expect.closeTo(50, 6),
        shippingCostCents: 4000,
      },
      {
        warehouseId: 2,
        quantity: 20,
        distanceKm: expect.closeTo(150, 6),
        shippingCostCents: 3000,
      },
    ]);
    expect(result.totalShippingCostCents).toBe(7000);
  });

  it("three warehouses: matches the ticket's own worked example (A=100, B=20, C=0)", () => {
    // A: $1/unit, 100 stock. B: $2/unit, 50 stock. C: $3/unit, 200 stock. Order: 120.
    const a = warehouseAtDistance(100, 1, 100); // 100 cents/unit = $1
    const b = warehouseAtDistance(200, 2, 50); // 200 cents/unit = $2
    const c = warehouseAtDistance(300, 3, 200); // 300 cents/unit = $3

    const result = allocateOrder(120, DESTINATION, [c, a, b], WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations).toEqual([
      {
        warehouseId: 1,
        quantity: 100,
        distanceKm: expect.closeTo(100, 6),
        shippingCostCents: 10000,
      },
      {
        warehouseId: 2,
        quantity: 20,
        distanceKm: expect.closeTo(200, 6),
        shippingCostCents: 4000,
      },
    ]);
    // Warehouse C is never touched — cheaper stock covered the whole order.
    expect(result.allocations.find((line) => line.warehouseId === 3)).toBeUndefined();
    expect(result.totalShippingCostCents).toBe(14000); // $140.00
  });

  it("exact stock: fully drains every warehouse needed with nothing left over or short", () => {
    const a = warehouseAtDistance(10, 1, 100);
    const b = warehouseAtDistance(20, 2, 50);
    const untouchedButCheaperNever = warehouseAtDistance(30, 3, 999); // more expensive, unused

    const result = allocateOrder(150, DESTINATION, [a, b, untouchedButCheaperNever], WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations.map((l) => ({ warehouseId: l.warehouseId, quantity: l.quantity }))).toEqual([
      { warehouseId: 1, quantity: 100 },
      { warehouseId: 2, quantity: 50 },
    ]);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).toBe(150);
  });

  it("insufficient stock: reports unfulfilled and allocates only what's available", () => {
    const a = warehouseAtDistance(10, 1, 30);
    const b = warehouseAtDistance(20, 2, 40);

    const result = allocateOrder(100, DESTINATION, [a, b], WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(false);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).toBe(70); // all available stock, short of the requested 100
    for (const line of result.allocations) {
      const warehouse = [a, b].find((w) => w.warehouseId === line.warehouseId)!;
      expect(line.quantity).toBeLessThanOrEqual(warehouse.stock);
    }
  });

  it("insufficient stock: detects a total shortfall even with many warehouses", () => {
    const warehouses = [
      warehouseAtDistance(10, 1, 5),
      warehouseAtDistance(20, 2, 5),
      warehouseAtDistance(30, 3, 5),
    ];

    const result = allocateOrder(1000, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(false);
    expect(result.allocations.reduce((sum, l) => sum + l.quantity, 0)).toBe(15);
  });

  it("equal shipping cost: ties are broken deterministically (ascending warehouseId)", () => {
    const sameDistance = 100;
    const lowerId = warehouseAtDistance(sameDistance, 1, 30);
    const higherId = warehouseAtDistance(sameDistance, 2, 40);

    // Pass in reverse order to prove the tie-break isn't just "input order preserved".
    const result = allocateOrder(50, DESTINATION, [higherId, lowerId], WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations).toEqual([
      {
        warehouseId: 1,
        quantity: 30,
        distanceKm: expect.closeTo(100, 6),
        shippingCostCents: 3000,
      },
      {
        warehouseId: 2,
        quantity: 20,
        distanceKm: expect.closeTo(100, 6),
        shippingCostCents: 2000,
      },
    ]);
  });

  it("large order: correctly spreads across many warehouses in cost order", () => {
    const warehouses = [10, 20, 30, 40, 50].map((distance, index) =>
      warehouseAtDistance(distance, index + 1, 30000)
    );

    const result = allocateOrder(100000, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations.map((l) => ({ warehouseId: l.warehouseId, quantity: l.quantity }))).toEqual([
      { warehouseId: 1, quantity: 30000 },
      { warehouseId: 2, quantity: 30000 },
      { warehouseId: 3, quantity: 30000 },
      { warehouseId: 4, quantity: 10000 },
      // warehouseId 5 (farthest) is never needed.
    ]);
    const totalAllocated = result.allocations.reduce((sum, l) => sum + l.quantity, 0);
    expect(totalAllocated).toBe(100000);
  });

  it("never allocates more than a warehouse's stock, and never allocates to zero-stock warehouses", () => {
    const warehouses = [
      warehouseAtDistance(10, 1, 5),
      warehouseAtDistance(20, 2, 0),
      warehouseAtDistance(30, 3, 200),
    ];

    const result = allocateOrder(50, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(result.fulfilled).toBe(true);
    expect(result.allocations.find((l) => l.warehouseId === 2)).toBeUndefined();
    for (const line of result.allocations) {
      const warehouse = warehouses.find((w) => w.warehouseId === line.warehouseId)!;
      expect(line.quantity).toBeLessThanOrEqual(warehouse.stock);
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
    expect(result.totalShippingCostCents).toBe(expectedTotal);
  });

  it("does not mutate the warehouses passed in", () => {
    const warehouses = [warehouseAtDistance(10, 1, 100)];
    const snapshot = JSON.parse(JSON.stringify(warehouses));

    allocateOrder(50, DESTINATION, warehouses, WEIGHT_KG, RATE);

    expect(warehouses).toEqual(snapshot);
  });
});
