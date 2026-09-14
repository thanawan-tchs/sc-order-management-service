import { Money } from "./money";
import { InvalidOrderReason } from "./validity";

/** A sellable product. Single SKU for v1, but modeled as its own entity for extensibility. */
export interface Item {
  id: number;
  name: string;
  priceCents: Money;
  weightGrams: number;
}

/** A physical fulfillment location. Stock lives separately, in Inventory (see SYSTEM-DESIGN.md). */
export interface Warehouse {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

/** Stock of a given Item at a given Warehouse. */
export interface Inventory {
  warehouseId: number;
  itemId: number;
  stock: number;
}

export interface ShippingAddress {
  latitude: number;
  longitude: number;
}

/** How many units of an order ship from a single warehouse, and what that costs. */
export interface ShippingAllocation {
  warehouseId: number;
  quantity: number;
  distanceKm: number;
  shippingCostCents: Money;
}

/**
 * The full computed breakdown for an order request — what `POST /v1/orders/quote` returns, and
 * what `POST /v1/orders` must recompute (against fresh stock) before persisting as an Order.
 */
export interface OrderQuote {
  quantity: number;
  shippingAddress: ShippingAddress;
  subtotalCents: Money;
  discountRate: number;
  discountCents: Money;
  amountAfterDiscountCents: Money;
  totalWeightKg: number;
  shippingCostCents: Money;
  totalCents: Money;
  valid: boolean;
  invalidReasons: InvalidOrderReason[];
  allocations: ShippingAllocation[];
}

/** Only one status exists today (an order that reaches persistence was already validated at
 *  submission time, ticket 11) — kept as its own type so a future lifecycle (shipped, cancelled,
 *  ...) is additive, not a breaking change to `Order`. */
export type OrderStatus = "CONFIRMED";

/** A persisted, submitted order — a quote plus the identifiers/metadata that exist once saved. */
export interface Order extends OrderQuote {
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
}
