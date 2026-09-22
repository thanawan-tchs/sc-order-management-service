import { Money } from "../money";

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
