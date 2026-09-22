import { Money, toMoney } from "./money";

export interface DiscountTier {
  minQuantity: number;
  rate: number;
}

export const DISCOUNT_TIERS: DiscountTier[] = [
  { minQuantity: 250, rate: 0.2 },
  { minQuantity: 100, rate: 0.15 },
  { minQuantity: 50, rate: 0.1 },
  { minQuantity: 25, rate: 0.05 },
];

export function calculateSubtotal(quantity: number, unitPriceCents: Money): Money {
  return toMoney(quantity * unitPriceCents);
}

export function getDiscountRate(quantity: number): number {
  const tier = DISCOUNT_TIERS.find((t) => quantity >= t.minQuantity);
  return tier ? tier.rate : 0;
}

export function calculateDiscount(subtotal: Money, rate: number): Money {
  return toMoney(Math.round(subtotal * rate));
}

export function calculateAmountAfterDiscount(subtotal: Money, discount: Money): Money {
  return toMoney(subtotal - discount);
}
