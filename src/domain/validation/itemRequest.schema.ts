import { z } from "zod";

export const itemRequestSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().int().positive(),
  weightKg: z.number().finite().positive(),
});

export type ItemRequestInput = z.infer<typeof itemRequestSchema>;
