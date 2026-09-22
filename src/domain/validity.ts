import { Money } from "./money";

export type InvalidOrderReason = "INSUFFICIENT_STOCK" | "SHIPPING_COST_EXCEEDS_15_PERCENT";

export const MAX_SHIPPING_RATIO = 0.15;

export function isShippingCostWithinLimit(
  shippingCostCents: Money,
  amountAfterDiscountCents: Money
): boolean {
  return shippingCostCents * 100 <= amountAfterDiscountCents * 15;
}
