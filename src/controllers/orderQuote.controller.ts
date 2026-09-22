import { Context } from "koa";
import { getOrderQuote } from "../application/orders/orderQuoteService";
import { OrderQuote } from "../domain/model/order";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface QuoteResponseBody {
  valid: boolean;
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
    totalWeightKg: number;
    allocations: {
      warehouseId: number;
      quantity: number;
      distanceKm: number;
      shippingCost: number;
      currency: string;
    }[];
  };
  invalidReason: string | null;
}

function toQuoteResponse(quote: OrderQuote): QuoteResponseBody {
  return {
    valid: quote.valid,
    item: {
      id: quote.item.id,
      name: quote.item.name,
      price: quote.item.price,
      currency: quote.item.currency,
    },
    quantity: quote.quantity,
    pricing: {
      subtotal: quote.subtotal,
      discountRate: quote.discountRate,
      discount: quote.discount,
      amountAfterDiscount: quote.amountAfterDiscount,
      shippingCost: quote.shippingCost,
      total: quote.total,
      currency: quote.currency,
    },
    shipping: {
      totalWeightKg: quote.totalWeightKg,
      allocations: quote.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCost: allocation.shippingCost,
        currency: allocation.currency,
      })),
    },
    invalidReason: quote.invalidReasons[0] ?? null,
  };
}

export async function quoteOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  const quote = await getOrderQuote(input);

  ctx.status = 200;
  ctx.body = toQuoteResponse(quote);
}
