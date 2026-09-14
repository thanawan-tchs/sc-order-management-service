import { ITEM_WEIGHT_KG, SHIPPING_RATE_CENTS_PER_KG_KM } from "../config";
import { WarehouseCandidate, allocateOrder } from "../domain/allocation";
import { Money, toMoney } from "../domain/money";
import {
  calculateAmountAfterDiscount,
  calculateDiscount,
  calculateSubtotal,
  getDiscountRate,
} from "../domain/pricing";
import { OrderQuote, ShippingAddress } from "../domain/types";
import { InvalidOrderReason, isShippingCostWithinLimit } from "../domain/validity";
import { getAllWarehouses, getInventory } from "../repositories/warehouseRepository";

export interface OrderQuoteInput {
  quantity: number;
  shippingAddress: ShippingAddress;
}

/**
 * Reads a snapshot of every warehouse's current stock for the allocator to plan against — the
 * "Read current inventory" step of ticket 08's flow. Goes through the repository layer (ticket
 * 03); wrapped as its own function so it can be swapped out in tests (see `getOrderQuote`'s
 * `deps` parameter) without needing a live database for every orchestration test case.
 */
export async function readWarehouseCandidates(): Promise<WarehouseCandidate[]> {
  const warehouses = await getAllWarehouses();
  const inventories = await Promise.all(warehouses.map((warehouse) => getInventory(warehouse.id)));

  return warehouses.map((warehouse, index) => ({
    warehouseId: warehouse.id,
    latitude: warehouse.latitude,
    longitude: warehouse.longitude,
    stock: inventories[index]?.stock ?? 0,
  }));
}

export interface OrderQuoteDependencies {
  readWarehouseCandidates: () => Promise<WarehouseCandidate[]>;
}

const defaultDependencies: OrderQuoteDependencies = { readWarehouseCandidates };

/**
 * The complete side-effect-free order verification flow (ticket 08):
 *
 *   validate (upstream) -> read inventory -> price -> allocate (distance + cost) -> check 15%
 *   rule -> return quote
 *
 * Never creates an order, changes inventory, or reserves stock — every step here only reads.
 * Input is assumed already validated by the caller (ticket 02's `orderRequestSchema`, applied by
 * the controller that invokes this service — ticket 09) so validation logic isn't duplicated
 * here; this service starts from a trusted, typed `OrderQuoteInput`.
 *
 * `deps` defaults to the real repository-backed implementation; tests pass a fake
 * `readWarehouseCandidates` to exercise this orchestration without a live database (this service
 * has no HTTP dependencies either way — plain input in, plain OrderQuote out).
 */
export async function getOrderQuote(
  input: OrderQuoteInput,
  deps: OrderQuoteDependencies = defaultDependencies
): Promise<OrderQuote> {
  const candidates = await deps.readWarehouseCandidates();

  const subtotalCents = calculateSubtotal(input.quantity);
  const discountRate = getDiscountRate(input.quantity);
  const discountCents = calculateDiscount(subtotalCents, discountRate);
  const amountAfterDiscountCents = calculateAmountAfterDiscount(subtotalCents, discountCents);

  const allocationResult = allocateOrder(
    input.quantity,
    input.shippingAddress,
    candidates,
    ITEM_WEIGHT_KG,
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
    shippingAddress: input.shippingAddress,
    subtotalCents,
    discountRate,
    discountCents,
    amountAfterDiscountCents,
    totalWeightKg: input.quantity * ITEM_WEIGHT_KG,
    shippingCostCents,
    totalCents,
    valid: invalidReasons.length === 0,
    invalidReasons,
    allocations: allocationResult.allocations,
  };
}
