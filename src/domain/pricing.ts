import { Money, toMoney } from "./money";

export interface DiscountTier {
  minQuantity: number;
  rate: number;
}

/**
 * Volume discount tiers. Ordered highest threshold first so `getDiscountRate` can return the
 * first (i.e. highest) tier a given quantity meets or exceeds.
 */
export const DISCOUNT_TIERS: DiscountTier[] = [
  { minQuantity: 250, rate: 0.2 },
  { minQuantity: 100, rate: 0.15 },
  { minQuantity: 50, rate: 0.1 },
  { minQuantity: 25, rate: 0.05 },
];

/**
 * Pure pricing functions — the single pricing service both the quote and submit flows call
 * against (ticket 04 acceptance criteria), so discount rules live in exactly one place.
 *
 * `calculateSubtotal` takes the unit price as a parameter rather than reading a constant —
 * same shape as `calculateShippingCost`'s `unitWeightKg` param — so it works for whichever item
 * the caller looked up, not just a single hardcoded SKU.
 */

export function calculateSubtotal(quantity: number, unitPriceCents: Money): Money {
  return toMoney(quantity * unitPriceCents);
}

export function getDiscountRate(quantity: number): number {
  const tier = DISCOUNT_TIERS.find((t) => quantity >= t.minQuantity);
  return tier ? tier.rate : 0;
}

export function calculateDiscount(subtotal: Money, rate: number): Money {
  // Math.round guards against a non-integer result — not currently reachable given the fixed
  // $150 unit price and tier rates above (every product is already a whole number of cents),
  // but keeps the function correct if either ever changes. See Money's "no float money" contract.
  return toMoney(Math.round(subtotal * rate));
}

export function calculateAmountAfterDiscount(subtotal: Money, discount: Money): Money {
  return toMoney(subtotal - discount);
}
