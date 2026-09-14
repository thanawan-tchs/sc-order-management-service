import { calculateDistanceKm } from "./distance";
import { Money } from "./money";
import { calculateShippingCost, sumShippingCosts } from "./shipping";
import { ShippingAddress, ShippingAllocation } from "./types";

/** A warehouse merged with its current stock — the snapshot the caller (a later application
 *  service) is responsible for fetching via the warehouse/inventory repository and passing in. */
export interface WarehouseCandidate {
  warehouseId: number;
  latitude: number;
  longitude: number;
  stock: number;
}

export interface AllocationResult {
  allocations: ShippingAllocation[];
  /** True iff `quantity` was fully allocated. False means total available stock fell short —
   *  `allocations` still holds whatever partial split was possible, for a caller that wants to
   *  explain the shortfall rather than just reject. */
  fulfilled: boolean;
  totalShippingCostCents: Money;
}

/**
 * Greedy lowest-cost fulfillment of `quantity` units across `warehouses` (ticket 07).
 *
 * Greedy is optimal here — not just a heuristic — because every unit of the single SKU weighs
 * the same, shipping cost is linear in weight * distance, and there's no per-warehouse setup fee.
 * Under those conditions, the cheapest way to source N units is always to take as many as
 * possible from the cheapest-per-unit warehouse, then the next-cheapest, and so on: a textbook
 * exchange argument shows any allocation that isn't "cheapest first" can be improved by swapping
 * a unit from a pricier source for one from a cheaper source with spare stock, so no other
 * allocation can beat it.
 *
 * Pure and read-only: takes a stock snapshot and returns a proposed split, never mutates
 * inventory (ticket 07 — that happens in submit, a later ticket, inside its own transaction).
 */
export function allocateOrder(
  quantity: number,
  destination: ShippingAddress,
  warehouses: WarehouseCandidate[],
  unitWeightKg: number,
  ratePerKgPerKm: number
): AllocationResult {
  const candidates = warehouses
    .filter((w) => w.stock > 0)
    .map((w) => {
      const distanceKm = calculateDistanceKm({ latitude: w.latitude, longitude: w.longitude }, destination);
      const costPerUnitCents = calculateShippingCost(distanceKm, 1, unitWeightKg, ratePerKgPerKm);
      return { warehouse: w, distanceKm, costPerUnitCents };
    })
    // Cheapest per-unit first; ties broken by warehouseId so results are deterministic
    // regardless of input order (ticket 07's "equal shipping cost" case).
    .sort(
      (a, b) => a.costPerUnitCents - b.costPerUnitCents || a.warehouse.warehouseId - b.warehouse.warehouseId
    );

  const allocations: ShippingAllocation[] = [];
  let remaining = quantity;

  for (const candidate of candidates) {
    if (remaining <= 0) break;

    const take = Math.min(remaining, candidate.warehouse.stock);
    if (take <= 0) continue;

    allocations.push({
      warehouseId: candidate.warehouse.warehouseId,
      quantity: take,
      distanceKm: candidate.distanceKm,
      shippingCostCents: calculateShippingCost(candidate.distanceKm, take, unitWeightKg, ratePerKgPerKm),
    });

    remaining -= take;
  }

  return {
    allocations,
    fulfilled: remaining === 0,
    totalShippingCostCents: sumShippingCosts(allocations.map((a) => a.shippingCostCents)),
  };
}
