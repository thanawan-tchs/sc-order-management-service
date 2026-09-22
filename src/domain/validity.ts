import { Money } from "./money";

export type InvalidOrderReason = "INSUFFICIENT_STOCK" | "SHIPPING_COST_EXCEEDS_15_PERCENT";

export const MAX_SHIPPING_RATIO = 0.15;

export function isShippingCostWithinLimit(
  shippingCost: Money,
  amountAfterDiscount: Money
): boolean {
  return shippingCost * 100 <= amountAfterDiscount * 15;
}
