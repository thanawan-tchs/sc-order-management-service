import { Money } from "./money";
import { InvalidOrderReason } from "./validity";

/** A sellable product, looked up by client-chosen `itemId` (the `items` table). `id` is a UUID
 *  (Postgres's `gen_random_uuid()`, ticket "use item id as uuid format"), not an integer. */
export interface Item {
  id: string;
  name: string;
  priceCents: Money;
  weightKg: number;
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
  itemId: string;
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
 *
 * `item` is a full snapshot (id/name/price/weight), not just an id — same Snapshot Principle as
 * pricing/discount/shipping below: a later price change to the item in the catalog must never
 * retroactively alter a historical order's displayed details.
 */
export interface OrderQuote {
  quantity: number;
  item: Item;
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
