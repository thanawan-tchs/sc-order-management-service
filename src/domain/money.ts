/**
 * Money is always an integer number of cents (see SYSTEM-DESIGN.md "Money") — never a float
 * dollar amount, to avoid floating point drift in financial calculations.
 *
 * Branded as a distinct type so a plain `number` (e.g. a raw distance or quantity) can't be
 * passed where a money value is expected without going through `toMoney`.
 */
export type Money = number & { readonly __brand: "Money" };

export function toMoney(cents: number): Money {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be an integer number of cents, got ${cents}`);
  }
  return cents as Money;
}

export const ZERO_MONEY = toMoney(0);
