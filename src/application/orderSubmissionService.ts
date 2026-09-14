import { IdempotencyKeyConflictError, OrderSubmissionError } from "../domain/errors";
import { Order, ShippingAddress } from "../domain/types";
import { withTransaction } from "../infrastructure/db/transaction";
import {
  createOrder,
  findOrderByIdempotencyKey,
  recordIdempotencyKey,
} from "../repositories/orderRepository";
import { decrementInventory } from "../repositories/warehouseRepository";
import { getOrderQuote, readWarehouseCandidates } from "./orderQuoteService";

export interface OrderSubmissionInput {
  quantity: number;
  shippingAddress: ShippingAddress;
  /** Optional client-generated `Idempotency-Key` (ticket 13). When present, a repeated
   *  submission with the same key returns the original order instead of creating another one. */
  idempotencyKey?: string;
}

/**
 * Ticket 11/13: atomic, idempotent order submission.
 *
 *   (fast path) already claimed by this idempotency key? -> return that order, no transaction
 *   BEGIN
 *     -> (race-closing re-check) already claimed by this key? -> return that order
 *     -> read current inventory (inside the transaction, via `client`)
 *     -> price + allocate + check the 15% rule — the exact same calculation
 *        `getOrderQuote` uses (ticket 08), just fed inventory read through this transaction's
 *        client instead of the pool. "Critical Rule": the server always recalculates from
 *        scratch here — the input is only `quantity`/`shippingAddress`, so there is no
 *        price/discount/shipping/allocation value from the client to (mis)trust in the first
 *        place.
 *     -> if invalid: throw (caught below) -> ROLLBACK, nothing written, idempotency key stays free
 *     -> atomically deduct inventory per allocation line
 *     -> create the order + its allocations
 *     -> claim the idempotency key (if given) — throws IdempotencyKeyConflictError if a
 *        concurrent submission using the same key claimed it first
 *   COMMIT
 *   (on IdempotencyKeyConflictError) -> the whole transaction above rolled back (including our
 *     own decrements/order); the winner's must have committed for us to have lost the race at
 *     all, so its order now exists — fetch and return it instead of erroring.
 *
 * If any step after BEGIN throws — an invalid recalculated order, a concurrent submission
 * winning the race for the same stock (a guarded decrement affecting 0 rows throws
 * `InsufficientStockError`), or a lost idempotency-key race — `withTransaction` rolls back
 * everything, including any decrements already applied earlier in this same call. No partial
 * inventory deduction and no order ever persist for a failed submission, and (ticket 13) no
 * idempotency key is ever left claimed by a failed attempt.
 */
export async function submitOrder(input: OrderSubmissionInput): Promise<Order> {
  const { idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
  }

  try {
    return await withTransaction(async (client) => {
      if (idempotencyKey) {
        // Closes the window between the fast pre-check above and this transaction starting.
        const existing = await findOrderByIdempotencyKey(idempotencyKey, client);
        if (existing) return existing;
      }

      const quote = await getOrderQuote(input, {
        readWarehouseCandidates: () => readWarehouseCandidates(client),
      });

      if (!quote.valid) {
        throw new OrderSubmissionError(quote.invalidReasons);
      }

      for (const line of quote.allocations) {
        await decrementInventory(line.warehouseId, line.quantity, client);
      }

      const order = await createOrder(quote, client);

      if (idempotencyKey) {
        await recordIdempotencyKey(idempotencyKey, order.orderNumber, client);
      }

      return order;
    });
  } catch (error) {
    if (idempotencyKey && error instanceof IdempotencyKeyConflictError) {
      const winner = await findOrderByIdempotencyKey(idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}
