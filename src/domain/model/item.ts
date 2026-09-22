import { Currency, Money } from "../money";

export interface Item {
  id: string;
  name: string;
  price: Money;
  currency: Currency;
  weightKg: number;
}
