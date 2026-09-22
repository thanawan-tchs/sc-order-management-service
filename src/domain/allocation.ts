import { calculateDistanceKm } from "./distance";
import { Money } from "./money";
import { calculateShippingCost, sumShippingCosts } from "./shipping";
import { ShippingAddress, ShippingAllocation } from "./model/shipping";

export interface WarehouseCandidate {
  warehouseId: number;
  latitude: number;
  longitude: number;
  stock: number;
}

export interface AllocationResult {
  allocations: ShippingAllocation[];
  fulfilled: boolean;
  totalShippingCost: Money;
}

export function allocateOrder(
  quantity: number,
  destination: ShippingAddress,
  warehouses: WarehouseCandidate[],
  unitWeightKg: number,
  ratePerKgPerKm: number,
  currency: string
): AllocationResult {
  const candidates = warehouses
    .filter((w) => w.stock > 0)
    .map((w) => {
      const distanceKm = calculateDistanceKm({ latitude: w.latitude, longitude: w.longitude }, destination);
      const costPerUnit = calculateShippingCost(distanceKm, 1, unitWeightKg, ratePerKgPerKm);
      return { warehouse: w, distanceKm, costPerUnit };
    })
    .sort(
      (a, b) => a.costPerUnit - b.costPerUnit || a.warehouse.warehouseId - b.warehouse.warehouseId
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
      shippingCost: calculateShippingCost(candidate.distanceKm, take, unitWeightKg, ratePerKgPerKm),
      currency,
    });

    remaining -= take;
  }

  return {
    allocations,
    fulfilled: remaining === 0,
    totalShippingCost: sumShippingCosts(allocations.map((a) => a.shippingCost)),
  };
}
