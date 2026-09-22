import { Context } from "koa";
import * as getOrderService from "@application/orders/getOrderService";
import { OrderNotFoundError } from "@domain/errors";
import { Order } from "@domain/model/order";
import { toDisplayAmount } from "@utils/money";

interface OrderDetailResponseBody {
  orderNumber: string;
  status: string;
  item: {
    id: string;
    name: string;
    price: number;
    currency: string;
  };
  quantity: number;
  destination: { latitude: number; longitude: number };
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
  createdAt: string;
}

function toOrderDetailResponse(order: Order): OrderDetailResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    item: {
      id: order.item.id,
      name: order.item.name,
      price: toDisplayAmount(order.item.price),
      currency: order.item.currency,
    },
    quantity: order.quantity,
    destination: order.shippingAddress,
    pricing: {
      subtotal: toDisplayAmount(order.subtotal),
      discountRate: order.discountRate,
      discount: toDisplayAmount(order.discount),
      amountAfterDiscount: toDisplayAmount(order.amountAfterDiscount),
      shippingCost: toDisplayAmount(order.shippingCost),
      total: toDisplayAmount(order.total),
      currency: order.currency,
    },
    shipping: {
      allocations: order.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCost: toDisplayAmount(allocation.shippingCost),
        currency: allocation.currency,
      })),
    },
    createdAt: order.createdAt,
  };
}

export async function getOrder(ctx: Context): Promise<void> {
  const { orderNumber } = ctx.params;
  ctx.state.orderNumber = orderNumber;

  const order = await getOrderService.getOrder(orderNumber);
  if (!order) {
    throw new OrderNotFoundError(orderNumber);
  }

  ctx.status = 200;
  ctx.body = toOrderDetailResponse(order);
}
