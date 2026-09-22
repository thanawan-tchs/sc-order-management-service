import { Money, toMoney } from "./money";

export function calculateShippingCost(
  distanceKm: number,
  quantity: number,
  unitWeightKg: number,
  ratePerKgPerKm: number
): Money {
  const weightKg = quantity * unitWeightKg;
  const rawCents = distanceKm * weightKg * ratePerKgPerKm;
  return toMoney(Math.round(rawCents));
}

export function sumShippingCosts(costs: Money[]): Money {
  return toMoney(costs.reduce((total, cost) => total + cost, 0));
}
