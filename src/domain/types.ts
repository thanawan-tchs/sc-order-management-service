import { Money } from "./money";

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
  shippingCostCents: Money;
  totalCents: Money;
  valid: boolean;
  invalidReasons: string[];
  allocations: ShippingAllocation[];
}

/** A persisted, submitted order — a quote plus the identifiers/metadata that exist once saved. */
export interface Order extends OrderQuote {
  orderNumber: string;
  createdAt: string;
}
