import { Context } from "koa";
import * as orderSubmissionService from "../application/orderSubmissionService";
import { InsufficientStockError, OrderSubmissionError } from "../domain/errors";
import { Order } from "../domain/types";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface OrderResponseBody {
  orderNumber: string;
  status: string;
  quantity: number;
  pricing: {
    subtotalCents: number;
    discountRate: number;
    discountCents: number;
    amountAfterDiscountCents: number;
    shippingCents: number;
    totalCents: number;
  };
  shipping: {
    allocations: {
      warehouseId: number;
      quantity: number;
      distanceKm: number;
      shippingCents: number;
    }[];
  };
}

/**
 * Maps the domain Order to the HTTP response contract (ticket 12). Reuses the same pricing/
 * allocation shape the quote controller uses (a fuller snapshot than the ticket's own minimal
 * example, which drops discountRate/amountAfterDiscountCents) — a client that has integrated
 * with the quote endpoint sees the identical shape here, and the "Include... pricing snapshot"
 * acceptance criterion reads more naturally as "the whole snapshot" than a truncated subset.
 */
function toOrderResponse(order: Order): OrderResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    quantity: order.quantity,
    pricing: {
      subtotalCents: order.subtotalCents,
      discountRate: order.discountRate,
      discountCents: order.discountCents,
      amountAfterDiscountCents: order.amountAfterDiscountCents,
      shippingCents: order.shippingCostCents,
      totalCents: order.totalCents,
    },
    shipping: {
      allocations: order.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCents: allocation.shippingCostCents,
      })),
    },
  };
}

/**
 * POST /v1/orders. Controller responsibilities per ticket 12: parse/validate is already done
 * (`validateBody`, same schema as quote — see orders.route.ts), so this only invokes the
 * transactional submission service and maps its outcome to an HTTP response. No pricing or
 * allocation logic belongs here — in particular, nothing from the request body reaches
 * `orderSubmissionService.submitOrder` except `quantity`/`shippingAddress`, so a client has no
 * price/discount/shipping/allocation field to override in the first place.
 *
 * Status codes: `201` on success; `422` when the recalculated order fails a business rule
 * (`OrderSubmissionError` — insufficient stock and/or shipping over 15%, ticket 08's reasons);
 * `409` when a concurrent submission wins a race for the same stock after this one was otherwise
 * valid (`InsufficientStockError` surfacing directly from a live conflict, ticket 11) — a
 * transient, retry-friendly conflict, distinct from a durable business rejection. `400` for a
 * malformed request is handled entirely by `validateBody` upstream; this handler is never reached
 * for that case.
 */
export async function submitOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  // Header names are case-insensitive in HTTP; ctx.get() normalizes for us. An empty/whitespace
  // header is treated the same as no header at all (ticket 13's Idempotency-Key is optional).
  const idempotencyKey = ctx.get("Idempotency-Key").trim() || undefined;

  let order: Order;
  try {
    order = await orderSubmissionService.submitOrder({ ...input, idempotencyKey });
  } catch (error) {
    if (error instanceof OrderSubmissionError) {
      ctx.status = 422;
      ctx.body = {
        error: "ORDER_INVALID",
        message: error.message,
        invalidReasons: error.invalidReasons,
      };
      return;
    }
    if (error instanceof InsufficientStockError) {
      ctx.status = 409;
      ctx.body = {
        error: "INVENTORY_CONFLICT",
        message: "Inventory changed before this order could be fulfilled. Please retry.",
      };
      return;
    }
    throw error;
  }

  ctx.status = 201;
  ctx.body = toOrderResponse(order);
}
