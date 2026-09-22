import { Context } from "koa";
import * as orderSubmissionService from "../application/orders/orderSubmissionService";
import { Order } from "../domain/model/order";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface OrderResponseBody {
  orderNumber: string;
  status: string;
  item: {
    id: string;
    name: string;
    price: number;
    currency: string;
  };
  quantity: number;
  pricing: {
    subtotal: number;
    discountRate: number;
    discount: number;
    amountAfterDiscount: number;
    shippingCost: number;
    total: number;
    currency: string;
  };
  shipping: {
    allocations: {
      warehouseId: number;
      quantity: number;
      distanceKm: number;
      shippingCost: number;
      currency: string;
    }[];
  };
}

function toOrderResponse(order: Order): OrderResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    item: {
      id: order.item.id,
      name: order.item.name,
      price: order.item.price,
      currency: order.item.currency,
    },
    quantity: order.quantity,
    pricing: {
      subtotal: order.subtotal,
      discountRate: order.discountRate,
      discount: order.discount,
      amountAfterDiscount: order.amountAfterDiscount,
      shippingCost: order.shippingCost,
      total: order.total,
      currency: order.currency,
    },
    shipping: {
      allocations: order.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCost: allocation.shippingCost,
        currency: allocation.currency,
      })),
    },
  };
}

export async function submitOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  const idempotencyKey = ctx.get("Idempotency-Key").trim() || undefined;

  const order: Order = await orderSubmissionService.submitOrder({ ...input, idempotencyKey });

  ctx.state.orderNumber = order.orderNumber;
  ctx.status = 201;
  ctx.body = toOrderResponse(order);
}
