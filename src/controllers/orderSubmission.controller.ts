import { Context } from "koa";
import * as orderSubmissionService from "../application/orderSubmissionService";
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
 * POST /v1/orders. Controller responsibilities per ticket 12, and nothing more: parse/validate is
 * already done (`validateBody`, same schema as quote — see orders.route.ts), so this only invokes
 * the transactional submission service and maps its result to the wire format. No pricing or
 * allocation logic belongs here — in particular, nothing from the request body reaches
 * `orderSubmissionService.submitOrder` except `quantity`/`shippingAddress`, so a client has no
 * price/discount/shipping/allocation field to override in the first place.
 *
 * No try/catch here (ticket 15): `submitOrder` throws typed `AppError`s (`OrderSubmissionError`
 * for a business rejection, `InsufficientStockError` for a live inventory conflict,
 * `IdempotencyKeyReusedError` for a mismatched key reuse) — they propagate to the central error
 * middleware, which is the only place that turns an error into a status/body. `400` for a
 * malformed request is handled the same way, entirely by `validateBody` upstream.
 */
export async function submitOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  // Header names are case-insensitive in HTTP; ctx.get() normalizes for us. An empty/whitespace
  // header is treated the same as no header at all (ticket 13's Idempotency-Key is optional).
  const idempotencyKey = ctx.get("Idempotency-Key").trim() || undefined;

  const order: Order = await orderSubmissionService.submitOrder({ ...input, idempotencyKey });

  ctx.status = 201;
  ctx.body = toOrderResponse(order);
}
