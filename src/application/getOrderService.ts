import { Order } from "../domain/types";
import * as orderRepository from "../repositories/orderRepository";

/**
 * Ticket 14: retrieves a previously submitted order by its order number.
 *
 * Returns exactly the persisted calculation snapshot (ticket 10's Snapshot Principle,
 * `getOrderByNumber` already just reads stored columns) — never recalculates pricing, distance,
 * or discount against today's rules, so a historical order's numbers don't shift if the business
 * constants (discount tiers, shipping rate, item price) change later.
 *
 * A thin wrapper today, but keeps the controller -> application service -> repository layering
 * consistent with the other two order endpoints, and gives future concerns (authorization,
 * caching) a natural home without touching the controller or repository.
 */
export async function getOrder(orderNumber: string): Promise<Order | undefined> {
  return orderRepository.getOrderByNumber(orderNumber);
}
