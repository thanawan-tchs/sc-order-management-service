import { Context } from "koa";
import { getOrderQuote } from "@application/orders/orderQuoteService";
import { OrderQuote } from "@domain/model/order";
import { OrderRequestInput } from "@domain/validation/orderRequest.schema";
import { toDisplayAmount } from "@utils/money";

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
      price: toDisplayAmount(quote.item.price),
      currency: quote.item.currency,
    },
    quantity: quote.quantity,
    pricing: {
      subtotal: toDisplayAmount(quote.subtotal),
      discountRate: quote.discountRate,
      discount: toDisplayAmount(quote.discount),
      amountAfterDiscount: toDisplayAmount(quote.amountAfterDiscount),
      shippingCost: toDisplayAmount(quote.shippingCost),
      total: toDisplayAmount(quote.total),
      currency: quote.currency,
    },
    shipping: {
      totalWeightKg: quote.totalWeightKg,
      allocations: quote.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCost: toDisplayAmount(allocation.shippingCost),
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
