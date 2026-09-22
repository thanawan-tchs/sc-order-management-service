import { SHIPPING_RATE_PER_KG_KM } from "@config";
import { WarehouseCandidate, allocateOrder } from "@domain/allocation";
import exception from "@domain/errors";
import { Money, toMoney } from "@domain/money";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "@domain/pricing";
import { OrderQuote } from "@domain/model/order";
import { ShippingAddress } from "@domain/model/shipping";
import { InvalidOrderReason, isShippingCostWithinLimit } from "@domain/validity";
import { QueryExecutor, getPool } from "@infrastructure/db/pool";
import itemRepository from "@repositories/itemRepository";
import warehouseRepository from "@repositories/warehouseRepository";

export interface OrderQuoteInput {
  itemId: string;
  quantity: number;
  shippingAddress: ShippingAddress;
}

export async function readWarehouseCandidates(
  itemId: string,
  executor: QueryExecutor = getPool()
): Promise<WarehouseCandidate[]> {
  const warehouses = await warehouseRepository.getAllWarehouses(executor);

  const candidates: WarehouseCandidate[] = [];
  for (const warehouse of warehouses) {
    const inventory = await warehouseRepository.getInventory(warehouse.id, itemId, executor);
    candidates.push({
      warehouseId: warehouse.id,
      latitude: warehouse.latitude,
      longitude: warehouse.longitude,
      stock: inventory?.stock ?? 0,
    });
  }

  return candidates;
}

export async function getOrderQuote(
  input: OrderQuoteInput,
  executor: QueryExecutor = getPool()
): Promise<OrderQuote> {
  const item = await itemRepository.getItem(input.itemId, executor);
  if (!item) {
    throw new exception.ItemNotFoundError(input.itemId);
  }

  const subtotal = calculateSubtotal(input.quantity, item.price);
  const discountRate = getDiscountRate(input.quantity);
  const discount = calculateDiscount(subtotal, discountRate);
  const amountAfterDiscount = calculateAmountAfterDiscount(subtotal, discount);

  const candidates = await readWarehouseCandidates(input.itemId, executor);

  const allocationResult = allocateOrder(
    input.quantity,
    input.shippingAddress,
    candidates,
    item.weightKg,
    SHIPPING_RATE_PER_KG_KM,
    item.currency
  );
  const shippingCost: Money = allocationResult.totalShippingCost;
  const total = toMoney(amountAfterDiscount + shippingCost);

  const invalidReasons: InvalidOrderReason[] = [];
  if (!allocationResult.fulfilled) {
    invalidReasons.push("INSUFFICIENT_STOCK");
  }
  if (!isShippingCostWithinLimit(shippingCost, amountAfterDiscount)) {
    invalidReasons.push("SHIPPING_COST_EXCEEDS_15_PERCENT");
  }

  return {
    quantity: input.quantity,
    item,
    shippingAddress: input.shippingAddress,
    subtotal,
    discountRate,
    discount,
    amountAfterDiscount,
    totalWeightKg: input.quantity * item.weightKg,
    shippingCost,
    total,
    currency: item.currency,
    valid: invalidReasons.length === 0,
    invalidReasons,
    allocations: allocationResult.allocations,
  };
}
