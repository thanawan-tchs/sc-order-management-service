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
