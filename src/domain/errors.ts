import { InvalidOrderReason } from "./validity";

/** Raised when a stock decrement can't be satisfied by the warehouse's current stock. */
export class InsufficientStockError extends Error {
  constructor(
    public readonly warehouseId: number,
    public readonly requestedQuantity: number
  ) {
    super(`Warehouse ${warehouseId} does not have ${requestedQuantity} unit(s) available.`);
    this.name = "InsufficientStockError";
  }
}

/**
 * Raised when a submission's recalculated order (ticket 11 — always recalculated at submission
 * time, never trusted from the client) turns out invalid. By the time this is thrown, the
 * transaction has already been rolled back by `withTransaction` — nothing was written.
 */
export class OrderSubmissionError extends Error {
  constructor(public readonly invalidReasons: InvalidOrderReason[]) {
    super(`Order cannot be submitted: ${invalidReasons.join(", ")}`);
    this.name = "OrderSubmissionError";
  }
}
