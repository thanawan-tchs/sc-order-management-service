import { Money } from "./money";
import { InvalidOrderReason } from "./validity";

export interface Item {
  id: string;
  name: string;
  priceCents: Money;
  weightKg: number;
}

export interface Warehouse {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Inventory {
  warehouseId: number;
  itemId: string;
  stock: number;
}

export interface ShippingAddress {
  latitude: number;
  longitude: number;
}

export interface ShippingAllocation {
  warehouseId: number;
  quantity: number;
  distanceKm: number;
  shippingCostCents: Money;
}

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

export type OrderStatus = "CONFIRMED";

export interface Order extends OrderQuote {
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
}
