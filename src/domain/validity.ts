import { Money } from "./money";

/**
 * A quote/order can fail more than one check at once (e.g. under-stocked *and* over the shipping
 * threshold) — reported as a set, not a first-match single reason.
 */
export type InvalidOrderReason = "INSUFFICIENT_STOCK" | "SHIPPING_COST_EXCEEDS_15_PERCENT";

/** Documentation constant for the 15% figure — the actual check below compares integer cents. */
export const MAX_SHIPPING_RATIO = 0.15;

/**
 * `shippingCost <= amountAfterDiscount * 15%` (ticket 08's business rule).
 *
 * Implemented as `shipping * 100 <= amountAfterDiscount * 15` rather than multiplying by the
 * literal `0.15`, so this stays an exact integer comparison — a "shipping is exactly 15%"
 * boundary case isn't at the mercy of 0.15's binary floating-point representation error.
 */
export function isShippingCostWithinLimit(
  shippingCostCents: Money,
  amountAfterDiscountCents: Money
): boolean {
  return shippingCostCents * 100 <= amountAfterDiscountCents * 15;
}
