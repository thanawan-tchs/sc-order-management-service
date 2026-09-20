import { z } from "zod";

/** Request schema for `POST /v1/items` — creating a catalog item (see itemRepository.ts). */
export const itemRequestSchema = z.object({
  name: z.string().trim().min(1),
  priceCents: z.number().int().positive(),
  weightKg: z.number().finite().positive(),
});

export type ItemRequestInput = z.infer<typeof itemRequestSchema>;
