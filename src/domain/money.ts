export type Money = number & { readonly __brand: "Money" };

export function toMoney(cents: number): Money {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be an integer number of cents, got ${cents}`);
  }
  return cents as Money;
}

export const ZERO_MONEY = toMoney(0);
