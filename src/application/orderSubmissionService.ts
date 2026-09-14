import { IdempotencyKeyConflictError, IdempotencyKeyReusedError, OrderSubmissionError } from "../domain/errors";
import { Order, ShippingAddress } from "../domain/types";
import { QueryExecutor } from "../infrastructure/db/pool";
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
 * True if `existing` (the order a key was already claimed for) matches what THIS request is
 * asking for. A matching retry is the normal case (ticket 13) — return the cached order. A
 * mismatch means the same key is being reused for a genuinely different order (ticket 15) —
 * that's a client bug worth surfacing, not something to silently paper over by either creating a
 * second order or returning the wrong one.
 */
function matchesClaimedOrder(existing: Order, input: OrderSubmissionInput): boolean {
  return (
    existing.quantity === input.quantity &&
    existing.shippingAddress.latitude === input.shippingAddress.latitude &&
    existing.shippingAddress.longitude === input.shippingAddress.longitude
  );
}

/**
 * Looks up whatever order (if any) `idempotencyKey` was already claimed for, and either returns
 * it (request matches) or throws `IdempotencyKeyReusedError` (request doesn't match — ticket 15).
 * Returns `undefined` when the key hasn't been claimed at all, so the caller proceeds normally.
 */
async function checkIdempotencyKey(
  idempotencyKey: string,
  input: OrderSubmissionInput,
  executor?: QueryExecutor
): Promise<Order | undefined> {
  const existing = await findOrderByIdempotencyKey(idempotencyKey, executor);
  if (!existing) return undefined;

  if (!matchesClaimedOrder(existing, input)) {
    throw new IdempotencyKeyReusedError(idempotencyKey);
  }
  return existing;
}

/**
 * Ticket 11/13/15: atomic, idempotent order submission.
 *
 *   (fast path) key already claimed?
 *     -> matches this request -> return that order, no transaction
 *     -> doesn't match -> throw IdempotencyKeyReusedError, no transaction
 *   BEGIN
 *     -> (race-closing re-check) same check as the fast path, again
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
 *     all, so its order now exists — fetch and return it instead of erroring (or throw
 *     IdempotencyKeyReusedError if even the winner's order doesn't match this request).
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
    const existing = await checkIdempotencyKey(idempotencyKey, input);
    if (existing) return existing;
  }

  try {
    return await withTransaction(async (client) => {
      if (idempotencyKey) {
        // Closes the window between the fast pre-check above and this transaction starting.
        const existing = await checkIdempotencyKey(idempotencyKey, input, client);
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
    }, "order_submission");
  } catch (error) {
    if (idempotencyKey && error instanceof IdempotencyKeyConflictError) {
      const winner = await checkIdempotencyKey(idempotencyKey, input);
      if (winner) return winner;
    }
    throw error;
  }
}
