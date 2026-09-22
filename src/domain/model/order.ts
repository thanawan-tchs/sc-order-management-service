import { Money } from "../money";
import { InvalidOrderReason } from "../validity";
import { Item } from "./item";
import { ShippingAddress, ShippingAllocation } from "./shipping";

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
