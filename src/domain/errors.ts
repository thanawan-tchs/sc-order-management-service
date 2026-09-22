import { InvalidOrderReason } from "./validity";

/**
 * Base for every error the central error-handling middleware (ticket 15) knows how to turn into
 * a consistent `{ error: { code, message } }` response, at the `status` the error carries.
 * Anything NOT an `AppError` is treated as unexpected — logged in full server-side, never leaked
 * to the client beyond a generic 500 (see middleware/errorHandler.ts).
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
}

/**
 * Raised by `validateBody` (ticket 02/15) for a malformed request body. `code` is set per
 * instance rather than fixed on the class — ticket 15 wants field-specific codes
 * (INVALID_QUANTITY, INVALID_LATITUDE, INVALID_LONGITUDE) for the fields it names, with a generic
 * fallback for anything else (e.g. a missing shippingAddress object entirely).
 */
export class ValidationError extends AppError {
  readonly status = 400;

  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Raised when a stock decrement can't be satisfied by the warehouse's current stock — a live
 *  inventory conflict (ticket 11/13), not a business-rule rejection (see OrderSubmissionError). */
export class InsufficientStockError extends AppError {
  readonly status = 409;
  readonly code = "INVENTORY_CONFLICT";

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
 *
 * `code` is the first of possibly several simultaneous reasons (`INSUFFICIENT_STOCK` or
 * `SHIPPING_COST_EXCEEDS_15_PERCENT`, ticket 08's `InvalidOrderReason`) — both are top-level
 * error codes in ticket 15's list, not nested under one generic "order invalid" code.
 */
export class OrderSubmissionError extends AppError {
  readonly status = 422;
  readonly code: string;

  constructor(public readonly invalidReasons: InvalidOrderReason[]) {
    super(`Order cannot be submitted: ${invalidReasons.join(", ")}`);
    this.name = "OrderSubmissionError";
    this.code = invalidReasons[0];
  }
}

/**
 * Raised when a submission loses a race to another, concurrent submission using the same
 * Idempotency-Key (ticket 13) — i.e. this transaction's own attempt to claim the key hit the
 * `idempotency_keys` table's PRIMARY KEY constraint because the other request's claim committed
 * first. The caller (orderSubmissionService) catches this and returns the winner's order instead
 * of surfacing an error — from the client's point of view, both requests succeed identically.
 *
 * Deliberately NOT an `AppError`: this is purely an internal control-flow signal between
 * orderRepository and orderSubmissionService and is always caught before it could reach the HTTP
 * layer, so it has no meaningful status/code of its own — giving it fake ones would suggest a
 * client-facing meaning it doesn't have. If this ever *did* escape uncaught, the error middleware
 * would (correctly) treat it as an unexpected 500, which is the safe default for a bug of that
 * shape rather than mislabeling it as one of the defined client-facing errors.
 */
export class IdempotencyKeyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was claimed by a concurrent request.`);
    this.name = "IdempotencyKeyConflictError";
  }
}

/**
 * Raised when a client reuses an `Idempotency-Key` for a request whose `quantity`/
 * `shippingAddress` doesn't match the original request that key was claimed for (ticket 15).
 * A *matching* retry is the normal, supported case (ticket 13) and returns the original order
 * silently, not an error — this is specifically for the case the key is being reused for what is,
 * as far as this service can tell, a genuinely different order.
 */
export class IdempotencyKeyReusedError extends AppError {
  readonly status = 409;
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was already used for a different request.`);
    this.name = "IdempotencyKeyReusedError";
  }
}

/** Raised when no order exists with the given order number (ticket 14/15). */
export class OrderNotFoundError extends AppError {
  readonly status = 404;
  readonly code = "ORDER_NOT_FOUND";

  constructor(public readonly orderNumber: string) {
    super(`No order found with order number "${orderNumber}".`);
    this.name = "OrderNotFoundError";
  }
}

/** Raised when a quote/submit request names an `itemId` that doesn't exist in the catalog. */
export class ItemNotFoundError extends AppError {
  readonly status = 404;
  readonly code = "ITEM_NOT_FOUND";

  constructor(public readonly itemId: string) {
    super(`No item found with id ${itemId}.`);
    this.name = "ItemNotFoundError";
  }
}
