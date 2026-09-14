import { Context } from "koa";
import * as getOrderService from "../application/getOrderService";
import { Order } from "../domain/types";

interface OrderDetailResponseBody {
  orderNumber: string;
  status: string;
  quantity: number;
  destination: { latitude: number; longitude: number };
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
  createdAt: string;
}

/** Maps the domain Order to the HTTP response contract (ticket 14) — same `pricing`/`shipping`
 *  shape the quote and submit controllers use, plus `destination` and `createdAt`, which those
 *  two don't return but this ticket explicitly asks for. */
function toOrderDetailResponse(order: Order): OrderDetailResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    quantity: order.quantity,
    destination: order.shippingAddress,
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
    createdAt: order.createdAt,
  };
}

/**
 * GET /v1/orders/:orderNumber. Controller responsibilities per ticket 14: read the :orderNumber
 * route param, ask the application service for it, map the result (or its absence) to an HTTP
 * response. Returns exactly the persisted snapshot — no recalculation happens anywhere in this
 * path (see getOrderService.ts).
 *
 * `200` with the order when found; `404` when no order exists with that order number.
 */
export async function getOrder(ctx: Context): Promise<void> {
  const { orderNumber } = ctx.params;
  const order = await getOrderService.getOrder(orderNumber);

  if (!order) {
    ctx.status = 404;
    ctx.body = {
      error: "ORDER_NOT_FOUND",
      message: `No order found with order number "${orderNumber}".`,
    };
    return;
  }

  ctx.status = 200;
  ctx.body = toOrderDetailResponse(order);
}
