import { z } from "zod";
import { CURRENCIES } from "../money";

export const itemRequestSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().int().positive(),
  currency: z.enum(CURRENCIES),
  weightKg: z.number().finite().positive(),
});

export type ItemRequestInput = z.infer<typeof itemRequestSchema>;
