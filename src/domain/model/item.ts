import { Money } from "../money";

export interface Item {
  id: string;
  name: string;
  priceCents: Money;
  weightKg: number;
}
