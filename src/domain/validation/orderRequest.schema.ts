import { z } from "zod";

export const shippingAddressSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const orderRequestSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  shippingAddress: shippingAddressSchema,
});

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;
export type OrderRequestInput = z.infer<typeof orderRequestSchema>;
