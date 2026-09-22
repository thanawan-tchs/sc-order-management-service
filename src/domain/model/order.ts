import { Money } from "../money";
import { InvalidOrderReason } from "../validity";
import { Item } from "./item";
import { ShippingAddress, ShippingAllocation } from "./shipping";

export interface OrderQuote {
  quantity: number;
  item: Item;
  shippingAddress: ShippingAddress;
  subtotal: Money;
  discountRate: number;
  discount: Money;
  amountAfterDiscount: Money;
  totalWeightKg: number;
  shippingCost: Money;
  total: Money;
  currency: string;
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
