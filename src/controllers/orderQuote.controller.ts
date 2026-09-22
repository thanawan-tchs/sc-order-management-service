import { Context } from "koa";
import { getOrderQuote } from "../application/orders/orderQuoteService";
import { OrderQuote } from "../domain/types";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface QuoteResponseBody {
  valid: boolean;
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
    totalWeightKg: number;
    allocations: {
      warehouseId: number;
      quantity: number;
      distanceKm: number;
      shippingCents: number;
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
      priceCents: quote.item.priceCents,
    },
    quantity: quote.quantity,
    pricing: {
      subtotalCents: quote.subtotalCents,
      discountRate: quote.discountRate,
      discountCents: quote.discountCents,
      amountAfterDiscountCents: quote.amountAfterDiscountCents,
      shippingCents: quote.shippingCostCents,
      totalCents: quote.totalCents,
    },
    shipping: {
      totalWeightKg: quote.totalWeightKg,
      allocations: quote.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        quantity: allocation.quantity,
        distanceKm: allocation.distanceKm,
        shippingCents: allocation.shippingCostCents,
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
