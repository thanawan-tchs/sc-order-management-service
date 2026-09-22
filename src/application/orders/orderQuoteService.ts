import { CURRENCY, SHIPPING_RATE_PER_KG_KM } from "../../config";
import { WarehouseCandidate, allocateOrder } from "../../domain/allocation";
import { ItemNotFoundError } from "../../domain/errors";
import { Money, toMoney } from "../../domain/money";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "../../domain/pricing";
import { Item } from "../../domain/model/item";
import { OrderQuote } from "../../domain/model/order";
import { ShippingAddress } from "../../domain/model/shipping";
import { InvalidOrderReason, isShippingCostWithinLimit } from "../../domain/validity";
import { QueryExecutor, getPool } from "../../infrastructure/db/pool";
import * as itemRepository from "../../repositories/itemRepository";
import * as warehouseRepository from "../../repositories/warehouseRepository";

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

export interface OrderQuoteDependencies {
  readWarehouseCandidates: (itemId: string) => Promise<WarehouseCandidate[]>;
  getItem: (itemId: string) => Promise<Item | undefined>;
}

const defaultDependencies: OrderQuoteDependencies = {
  readWarehouseCandidates,
  getItem: itemRepository.getItem,
};

export async function getOrderQuote(
  input: OrderQuoteInput,
  deps: OrderQuoteDependencies = defaultDependencies
): Promise<OrderQuote> {
  const item = await deps.getItem(input.itemId);
  if (!item) {
    throw new ItemNotFoundError(input.itemId);
  }

  const subtotal = calculateSubtotal(input.quantity, item.price);
  const discountRate = getDiscountRate(input.quantity);
  const discount = calculateDiscount(subtotal, discountRate);
  const amountAfterDiscount = calculateAmountAfterDiscount(subtotal, discount);

  const candidates = await deps.readWarehouseCandidates(input.itemId);

  const allocationResult = allocateOrder(
    input.quantity,
    input.shippingAddress,
    candidates,
    item.weightKg,
    SHIPPING_RATE_PER_KG_KM,
    CURRENCY
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
    currency: CURRENCY,
    valid: invalidReasons.length === 0,
    invalidReasons,
    allocations: allocationResult.allocations,
  };
}
