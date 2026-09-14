import { Money, toMoney } from "./money";

/**
 * Cost to ship `quantity` units of a `unitWeightKg`-weight item a distance of `distanceKm`, at
 * `ratePerKgPerKm` cents per kilogram per kilometer. Pure — takes rate/weight as parameters
 * rather than reading config itself — so both the quote and submit flows (ticket 08) call this
 * same calculator with the same business constants (ticket 06 acceptance criteria).
 *
 * Rounding policy: round to the nearest whole cent once, here, per allocation — never persist a
 * fractional cent (see Money's integer-cents contract). Multi-warehouse totals are then an exact
 * sum of already-rounded integers (`sumShippingCosts`), not a second rounding pass.
 */
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

/** Sums per-warehouse shipping costs into a single order total (ticket 06: multi-warehouse orders). */
export function sumShippingCosts(costs: Money[]): Money {
  return toMoney(costs.reduce((total, cost) => total + cost, 0));
}
