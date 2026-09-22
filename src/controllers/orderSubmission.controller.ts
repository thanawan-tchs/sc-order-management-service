import { Context } from "koa";
import * as orderSubmissionService from "../application/orderSubmissionService";
import { Order } from "../domain/types";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface OrderResponseBody {
  orderNumber: string;
  status: string;
  item: {
    id: string;
    name: string;
    priceCents: number;
  };
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

/** Maps the domain Order to the HTTP response contract — same pricing/allocation shape as the
 *  quote endpoint, so an integrated client sees an identical snapshot on both. */
function toOrderResponse(order: Order): OrderResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    item: {
      id: order.item.id,
      name: order.item.name,
      priceCents: order.item.priceCents,
    },
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

/** POST /v1/orders. `submitOrder` throws typed `AppError`s on failure, which always propagate to
 *  the central error middleware — this handler never touches `ctx.status`/`ctx.body` on failure. */
export async function submitOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  // Header names are case-insensitive in HTTP; ctx.get() normalizes for us. An empty/whitespace
  // header is treated the same as no header at all (ticket 13's Idempotency-Key is optional).
  const idempotencyKey = ctx.get("Idempotency-Key").trim() || undefined;

  const order: Order = await orderSubmissionService.submitOrder({ ...input, idempotencyKey });

  ctx.state.orderNumber = order.orderNumber;
  ctx.status = 201;
  ctx.body = toOrderResponse(order);
}
