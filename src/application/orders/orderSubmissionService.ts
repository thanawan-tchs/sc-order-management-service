import exception from "@domain/errors";
import { Order } from "@domain/model/order";
import { ShippingAddress } from "@domain/model/shipping";
import { QueryExecutor } from "@infrastructure/db/pool";
import { withTransaction } from "@infrastructure/db/transaction";
import itemRepository from "@repositories/itemRepository";
import orderRepository from "@repositories/orderRepository";
import warehouseRepository from "@repositories/warehouseRepository";
import { getOrderQuote, readWarehouseCandidates } from "./orderQuoteService";

export interface OrderSubmissionInput {
  itemId: string;
  quantity: number;
  shippingAddress: ShippingAddress;
  idempotencyKey?: string;
}

function matchesClaimedOrder(existing: Order, input: OrderSubmissionInput): boolean {
  return (
    existing.item.id === input.itemId &&
    existing.quantity === input.quantity &&
    existing.shippingAddress.latitude === input.shippingAddress.latitude &&
    existing.shippingAddress.longitude === input.shippingAddress.longitude
  );
}

async function checkIdempotencyKey(
  idempotencyKey: string,
  input: OrderSubmissionInput,
  executor?: QueryExecutor
): Promise<Order | undefined> {
  const existing = await orderRepository.findOrderByIdempotencyKey(idempotencyKey, executor);
  if (!existing) return undefined;

  if (!matchesClaimedOrder(existing, input)) {
    throw new exception.IdempotencyKeyReusedError(idempotencyKey);
  }
  return existing;
}

export async function submitOrder(input: OrderSubmissionInput): Promise<Order> {
  const { idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await checkIdempotencyKey(idempotencyKey, input);
    if (existing) return existing;
  }

  try {
    return await withTransaction(async (client) => {
      if (idempotencyKey) {
        const existing = await checkIdempotencyKey(idempotencyKey, input, client);
        if (existing) return existing;
      }

      const quote = await getOrderQuote(input, {
        readWarehouseCandidates: (itemId) => readWarehouseCandidates(itemId, client),
        getItem: (itemId) => itemRepository.getItem(itemId, client),
      });

      if (!quote.valid) {
        throw new exception.OrderSubmissionError(quote.invalidReasons);
      }

      for (const line of quote.allocations) {
        await warehouseRepository.decrementInventory(line.warehouseId, input.itemId, line.quantity, client);
      }

      const order = await orderRepository.createOrder(quote, client);

      if (idempotencyKey) {
        await orderRepository.recordIdempotencyKey(idempotencyKey, order.orderNumber, client);
      }

      return order;
    }, "order_submission");
  } catch (error) {
    if (idempotencyKey && error instanceof exception.IdempotencyKeyConflictError) {
      const winner = await checkIdempotencyKey(idempotencyKey, input);
      if (winner) return winner;
    }
    throw error;
  }
}

export default { submitOrder };
