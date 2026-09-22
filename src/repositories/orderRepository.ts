import { IdempotencyKeyConflictError } from "@domain/errors";
import { Currency, toMoney } from "@domain/money";
import { Order, OrderQuote, OrderStatus } from "@domain/model/order";
import { ShippingAllocation } from "@domain/model/shipping";
import { QueryExecutor, getPool } from "@infrastructure/db/pool";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION;
}

interface OrderRow {
  id: number;
  order_number: string;
  quantity: number;
  item_id: string;
  item_name: string;
  item_price: number;
  item_weight_kg: number;
  destination_latitude: number;
  destination_longitude: number;
  subtotal: number;
  discount_rate: number;
  discount: number;
  amount_after_discount: number;
  shipping: number;
  total: number;
  currency: Currency;
  status: OrderStatus;
  created_at: Date;
}

interface AllocationRow {
  warehouse_id: number;
  quantity: number;
  distance_km: number;
  shipping: number;
  currency: Currency;
}

function mapAllocationRow(row: AllocationRow): ShippingAllocation {
  return {
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
    distanceKm: row.distance_km,
    shippingCost: toMoney(row.shipping),
    currency: row.currency,
  };
}

function mapOrderRow(row: OrderRow, allocations: ShippingAllocation[]): Order {
  return {
    quantity: row.quantity,
    item: {
      id: row.item_id,
      name: row.item_name,
      price: toMoney(row.item_price),
      currency: row.currency,
      weightKg: row.item_weight_kg,
    },
    shippingAddress: { latitude: row.destination_latitude, longitude: row.destination_longitude },
    subtotal: toMoney(row.subtotal),
    discountRate: row.discount_rate,
    discount: toMoney(row.discount),
    amountAfterDiscount: toMoney(row.amount_after_discount),
    totalWeightKg: row.quantity * row.item_weight_kg,
    shippingCost: toMoney(row.shipping),
    total: toMoney(row.total),
    currency: row.currency,
    valid: true,
    invalidReasons: [],
    allocations,
    orderNumber: row.order_number,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

async function generateOrderNumber(executor: QueryExecutor): Promise<string> {
  const { rows } = await executor.query<{ seq: string }>("SELECT nextval('order_number_seq') AS seq");
  return `ORD-${rows[0].seq.padStart(7, "0")}`;
}

const INITIAL_ORDER_STATUS: OrderStatus = "CONFIRMED";

export async function createOrder(quote: OrderQuote, executor: QueryExecutor = getPool()): Promise<Order> {
  const orderNumber = await generateOrderNumber(executor);

  const { rows } = await executor.query<{ id: number; created_at: Date }>(
    `INSERT INTO orders (
       order_number, quantity, item_id, item_name, item_price, item_weight_kg,
       destination_latitude, destination_longitude,
       subtotal, discount_rate, discount, amount_after_discount,
       shipping, total, currency, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, created_at`,
    [
      orderNumber,
      quote.quantity,
      quote.item.id,
      quote.item.name,
      quote.item.price,
      quote.item.weightKg,
      quote.shippingAddress.latitude,
      quote.shippingAddress.longitude,
      quote.subtotal,
      quote.discountRate,
      quote.discount,
      quote.amountAfterDiscount,
      quote.shippingCost,
      quote.total,
      quote.currency,
      INITIAL_ORDER_STATUS,
    ]
  );
  const { id: orderId, created_at: createdAt } = rows[0];

  for (const allocation of quote.allocations) {
    await executor.query(
      `INSERT INTO order_allocations (order_id, warehouse_id, quantity, distance_km, shipping, currency)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderId,
        allocation.warehouseId,
        allocation.quantity,
        allocation.distanceKm,
        allocation.shippingCost,
        allocation.currency,
      ]
    );
  }

  return {
    ...quote,
    orderNumber,
    status: INITIAL_ORDER_STATUS,
    createdAt: createdAt.toISOString(),
  };
}

export async function getOrderByNumber(
  orderNumber: string,
  executor: QueryExecutor = getPool()
): Promise<Order | undefined> {
  const { rows } = await executor.query<OrderRow>(
    `SELECT id, order_number, quantity, item_id, item_name, item_price, item_weight_kg,
            destination_latitude, destination_longitude,
            subtotal, discount_rate, discount, amount_after_discount,
            shipping, total, currency, status, created_at
     FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  const orderRow = rows[0];
  if (!orderRow) return undefined;

  const { rows: allocationRows } = await executor.query<AllocationRow>(
    `SELECT warehouse_id, quantity, distance_km, shipping, currency
     FROM order_allocations WHERE order_id = $1 ORDER BY id`,
    [orderRow.id]
  );

  return mapOrderRow(orderRow, allocationRows.map(mapAllocationRow));
}

export async function findOrderByIdempotencyKey(
  idempotencyKey: string,
  executor: QueryExecutor = getPool()
): Promise<Order | undefined> {
  const { rows } = await executor.query<{ order_number: string }>(
    "SELECT order_number FROM idempotency_keys WHERE key = $1",
    [idempotencyKey]
  );
  const row = rows[0];
  if (!row) return undefined;

  return getOrderByNumber(row.order_number, executor);
}

export async function recordIdempotencyKey(
  idempotencyKey: string,
  orderNumber: string,
  executor: QueryExecutor = getPool()
): Promise<void> {
  try {
    await executor.query("INSERT INTO idempotency_keys (key, order_number) VALUES ($1, $2)", [
      idempotencyKey,
      orderNumber,
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new IdempotencyKeyConflictError(idempotencyKey);
    }
    throw error;
  }
}

export default { createOrder, getOrderByNumber, findOrderByIdempotencyKey, recordIdempotencyKey };
