import { Money } from "../domain/money";

export function toDisplayAmount(money: Money): number {
  return Math.round(money) / 100;
}
