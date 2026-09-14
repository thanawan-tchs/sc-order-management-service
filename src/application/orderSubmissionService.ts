import { OrderSubmissionError } from "../domain/errors";
import { Order, ShippingAddress } from "../domain/types";
import { withTransaction } from "../infrastructure/db/transaction";
import { createOrder } from "../repositories/orderRepository";
import { decrementInventory } from "../repositories/warehouseRepository";
import { getOrderQuote, readWarehouseCandidates } from "./orderQuoteService";

export interface OrderSubmissionInput {
  quantity: number;
  shippingAddress: ShippingAddress;
}

/**
 * Ticket 11: atomic order submission.
 *
 *   BEGIN
 *     -> read current inventory (inside the transaction, via `client`)
 *     -> price + allocate + check the 15% rule — the exact same calculation
 *        `getOrderQuote` uses (ticket 08), just fed inventory read through this transaction's
 *        client instead of the pool. "Critical Rule": the server always recalculates from
 *        scratch here — the input is only `quantity`/`shippingAddress`, so there is no
 *        price/discount/shipping/allocation value from the client to (mis)trust in the first
 *        place.
 *     -> if invalid: throw (caught below) -> ROLLBACK, nothing written
 *     -> atomically deduct inventory per allocation line
 *     -> create the order + its allocations
 *   COMMIT
 *
 * If any step after BEGIN throws — an invalid recalculated order, or a concurrent submission
 * winning the race for the same stock (a guarded decrement affecting 0 rows throws
 * `InsufficientStockError`) — `withTransaction` rolls back everything, including any decrements
 * already applied earlier in this same call. No partial inventory deduction and no order ever
 * persist for a failed submission.
 */
export async function submitOrder(input: OrderSubmissionInput): Promise<Order> {
  return withTransaction(async (client) => {
    const quote = await getOrderQuote(input, {
      readWarehouseCandidates: () => readWarehouseCandidates(client),
    });

    if (!quote.valid) {
      throw new OrderSubmissionError(quote.invalidReasons);
    }

    for (const line of quote.allocations) {
      await decrementInventory(line.warehouseId, line.quantity, client);
    }

    return createOrder(quote, client);
  });
}
