import { InvalidOrderReason } from "./validity";

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
}

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

export class OrderSubmissionError extends AppError {
  readonly status = 422;
  readonly code: string;

  constructor(public readonly invalidReasons: InvalidOrderReason[]) {
    super(`Order cannot be submitted: ${invalidReasons.join(", ")}`);
    this.name = "OrderSubmissionError";
    this.code = invalidReasons[0];
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was claimed by a concurrent request.`);
    this.name = "IdempotencyKeyConflictError";
  }
}

export class IdempotencyKeyReusedError extends AppError {
  readonly status = 409;
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was already used for a different request.`);
    this.name = "IdempotencyKeyReusedError";
  }
}

export class OrderNotFoundError extends AppError {
  readonly status = 404;
  readonly code = "ORDER_NOT_FOUND";

  constructor(public readonly orderNumber: string) {
    super(`No order found with order number "${orderNumber}".`);
    this.name = "OrderNotFoundError";
  }
}

export class ItemNotFoundError extends AppError {
  readonly status = 404;
  readonly code = "ITEM_NOT_FOUND";

  constructor(public readonly itemId: string) {
    super(`No item found with id ${itemId}.`);
    this.name = "ItemNotFoundError";
  }
}
