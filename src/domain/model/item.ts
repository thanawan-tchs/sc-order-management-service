import { Money } from "../money";

export interface Item {
  id: string;
  name: string;
  price: Money;
  weightKg: number;
}
