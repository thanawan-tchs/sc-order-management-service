import { Context } from "koa";
import * as getOrderService from "../application/orders/getOrderService";
import { OrderNotFoundError } from "../domain/errors";
import { Order } from "../domain/model/order";

interface OrderDetailResponseBody {
  orderNumber: string;
  status: string;
  item: {
    id: string;
    name: string;
    priceCents: number;
  };
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

function toOrderDetailResponse(order: Order): OrderDetailResponseBody {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    item: {
      id: order.item.id,
      name: order.item.name,
      priceCents: order.item.priceCents,
    },
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
