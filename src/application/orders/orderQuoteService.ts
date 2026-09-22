import { SHIPPING_RATE_CENTS_PER_KG_KM } from "../../config";
import { WarehouseCandidate, allocateOrder } from "../../domain/allocation";
import { ItemNotFoundError } from "../../domain/errors";
import { Money, toMoney } from "../../domain/money";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "../../domain/pricing";
import { Item, OrderQuote, ShippingAddress } from "../../domain/types";
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

  const subtotalCents = calculateSubtotal(input.quantity, item.priceCents);
  const discountRate = getDiscountRate(input.quantity);
  const discountCents = calculateDiscount(subtotalCents, discountRate);
  const amountAfterDiscountCents = calculateAmountAfterDiscount(subtotalCents, discountCents);

  const candidates = await deps.readWarehouseCandidates(input.itemId);

  const allocationResult = allocateOrder(
    input.quantity,
    input.shippingAddress,
    candidates,
    item.weightKg,
    SHIPPING_RATE_CENTS_PER_KG_KM
  );
  const shippingCostCents: Money = allocationResult.totalShippingCostCents;
  const totalCents = toMoney(amountAfterDiscountCents + shippingCostCents);

  const invalidReasons: InvalidOrderReason[] = [];
  if (!allocationResult.fulfilled) {
    invalidReasons.push("INSUFFICIENT_STOCK");
  }
  if (!isShippingCostWithinLimit(shippingCostCents, amountAfterDiscountCents)) {
    invalidReasons.push("SHIPPING_COST_EXCEEDS_15_PERCENT");
  }

  return {
    quantity: input.quantity,
    item,
    shippingAddress: input.shippingAddress,
    subtotalCents,
    discountRate,
    discountCents,
    amountAfterDiscountCents,
    totalWeightKg: input.quantity * item.weightKg,
    shippingCostCents,
    totalCents,
    valid: invalidReasons.length === 0,
    invalidReasons,
    allocations: allocationResult.allocations,
  };
}
