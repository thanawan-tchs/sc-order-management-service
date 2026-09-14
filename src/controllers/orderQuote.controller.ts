import { Context } from "koa";
import { getOrderQuote } from "../application/orderQuoteService";
import { OrderQuote } from "../domain/types";
import { OrderRequestInput } from "../domain/validation/orderRequest.schema";

interface QuoteResponseBody {
  valid: boolean;
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

/** Maps the domain OrderQuote to the HTTP response contract (ticket 09). Kept separate from the
 *  handler so the shaping logic — the only thing this layer is allowed to do — is easy to read
 *  in isolation from the HTTP plumbing around it. */
function toQuoteResponse(quote: OrderQuote): QuoteResponseBody {
  return {
    valid: quote.valid,
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
    // The API contract is a single reason-or-null; the domain layer tracks the full set of
    // reasons an order can be invalid for (ticket 08) since more than one can apply at once —
    // this surfaces the first/primary one for the HTTP response.
    invalidReason: quote.invalidReasons[0] ?? null,
  };
}

/**
 * POST /v1/orders/quote. Controller responsibilities per ticket 09, and nothing more: request
 * body is already parsed + validated by `validateBody` (see orders.route.ts) before this handler
 * runs, so all that's left is calling the application service and mapping its result to the wire
 * format. No pricing or allocation logic belongs here.
 */
export async function quoteOrder(ctx: Context): Promise<void> {
  const input = ctx.state.validated as OrderRequestInput;
  const quote = await getOrderQuote(input);

  ctx.status = 200;
  ctx.body = toQuoteResponse(quote);
}
