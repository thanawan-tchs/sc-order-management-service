import { z } from "zod";

/**
 * Shared request schema for both the quote and submit order APIs (SYSTEM-DESIGN.md's
 * `POST /v1/orders/quote` and `POST /v1/orders` take the same input shape). Defined once here so
 * controllers validate by reference instead of duplicating rules.
 *
 * `.finite()` is required in addition to `.number()`: zod's base number check already rejects
 * NaN, but not +/-Infinity — `.finite()` closes that gap for latitude/longitude.
 */
export const shippingAddressSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const orderRequestSchema = z.object({
  quantity: z.number().int().positive(),
  shippingAddress: shippingAddressSchema,
});

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;
export type OrderRequestInput = z.infer<typeof orderRequestSchema>;
