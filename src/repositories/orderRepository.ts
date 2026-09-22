import { CURRENCY } from "../config";
import { IdempotencyKeyConflictError } from "../domain/errors";
import { toMoney } from "../domain/money";
import { Order, OrderQuote, OrderStatus, ShippingAllocation } from "../domain/types";
import { QueryExecutor, getPool } from "../infrastructure/db/pool";

/** Postgres error code for a unique/primary-key constraint violation. `pg` attaches this to the
 *  thrown error's `.code` — used to tell "lost the idempotency-key race" apart from any other
 *  failure while inserting into `idempotency_keys`. */
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
  item_price_cents: number;
  item_weight_kg: number;
  destination_latitude: number;
  destination_longitude: number;
  subtotal_cents: number;
  discount_rate: number;
  discount_cents: number;
  amount_after_discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  status: OrderStatus;
  created_at: Date;
}

interface AllocationRow {
  warehouse_id: number;
  quantity: number;
  distance_km: number;
  shipping_cents: number;
}

function mapAllocationRow(row: AllocationRow): ShippingAllocation {
  return {
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
    distanceKm: row.distance_km,
    shippingCostCents: toMoney(row.shipping_cents),
  };
}

/**
 * Builds the domain `Order` for a row read back from the database. `valid`/`invalidReasons`
 * aren't persisted columns (ticket 10's schema doesn't list them) — only orders that were valid
 * at submission time are ever written (ticket 11 enforces that), so a row existing at all implies
 * `valid: true` here. `item` is rebuilt from the row's own `item_*` snapshot columns, not looked
 * up from `items` — the whole point of snapshotting is that a later catalog price change must
 * never alter what a historical order reports.
 */
function mapOrderRow(row: OrderRow, allocations: ShippingAllocation[]): Order {
  return {
    quantity: row.quantity,
    item: {
      id: row.item_id,
      name: row.item_name,
      priceCents: toMoney(row.item_price_cents),
      weightKg: row.item_weight_kg,
    },
    shippingAddress: { latitude: row.destination_latitude, longitude: row.destination_longitude },
    subtotalCents: toMoney(row.subtotal_cents),
    discountRate: row.discount_rate,
    discountCents: toMoney(row.discount_cents),
    amountAfterDiscountCents: toMoney(row.amount_after_discount_cents),
    totalWeightKg: row.quantity * row.item_weight_kg,
    shippingCostCents: toMoney(row.shipping_cents),
    totalCents: toMoney(row.total_cents),
    valid: true,
    invalidReasons: [],
    allocations,
    orderNumber: row.order_number,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

async function generateOrderNumber(executor: QueryExecutor): Promise<string> {
  // nextval() is atomic under Postgres MVCC regardless of concurrent callers (see
  // infrastructure/db/migrations/0002_orders.ts) — this is the whole concurrency-safety
  // mechanism, no application-level locking needed.
  const { rows } = await executor.query<{ seq: string }>("SELECT nextval('order_number_seq') AS seq");
  // pg returns bigint as a string (JS numbers can't safely hold the full int8 range) — fine here,
  // we only ever format it, never do arithmetic on it.
  return `ORD-${rows[0].seq.padStart(7, "0")}`;
}

/**
 * Persists an already-computed order snapshot (ticket 08's `OrderQuote`, unchanged) plus its
 * per-warehouse allocations, and assigns a unique, human-readable order number.
 *
 * This function does not validate the quote (`quote.valid` is the caller's concern — ticket 11's
 * atomic submission only calls this for orders it has already determined are valid) and does not
 * touch inventory — it is pure persistence, matching ticket 10's "Snapshot Principle": whatever
 * pricing/discount/shipping/item values are on `quote` are exactly what gets stored, so a later
 * change to discount tiers, the shipping rate, or an item's catalog price/name can never
 * retroactively alter a historical order.
 *
 * Accepts an optional `executor` (see infrastructure/db/pool.ts's `QueryExecutor`) so ticket 11
 * can run this inside the same transaction as its inventory decrements.
 */
const INITIAL_ORDER_STATUS: OrderStatus = "CONFIRMED";

export async function createOrder(quote: OrderQuote, executor: QueryExecutor = getPool()): Promise<Order> {
  const orderNumber = await generateOrderNumber(executor);

  const { rows } = await executor.query<{ id: number; created_at: Date }>(
    `INSERT INTO orders (
       order_number, quantity, item_id, item_name, item_price_cents, item_weight_kg,
       destination_latitude, destination_longitude,
       subtotal_cents, discount_rate, discount_cents, amount_after_discount_cents,
       shipping_cents, total_cents, currency, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, created_at`,
    [
      orderNumber,
      quote.quantity,
      quote.item.id,
      quote.item.name,
      quote.item.priceCents,
      quote.item.weightKg,
      quote.shippingAddress.latitude,
      quote.shippingAddress.longitude,
      quote.subtotalCents,
      quote.discountRate,
      quote.discountCents,
      quote.amountAfterDiscountCents,
      quote.shippingCostCents,
      quote.totalCents,
      CURRENCY,
      INITIAL_ORDER_STATUS,
    ]
  );
  const { id: orderId, created_at: createdAt } = rows[0];

  for (const allocation of quote.allocations) {
    await executor.query(
      `INSERT INTO order_allocations (order_id, warehouse_id, quantity, distance_km, shipping_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, allocation.warehouseId, allocation.quantity, allocation.distanceKm, allocation.shippingCostCents]
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
    `SELECT id, order_number, quantity, item_id, item_name, item_price_cents, item_weight_kg,
            destination_latitude, destination_longitude,
            subtotal_cents, discount_rate, discount_cents, amount_after_discount_cents,
            shipping_cents, total_cents, status, created_at
     FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  const orderRow = rows[0];
  if (!orderRow) return undefined;

  const { rows: allocationRows } = await executor.query<AllocationRow>(
    `SELECT warehouse_id, quantity, distance_km, shipping_cents
     FROM order_allocations WHERE order_id = $1 ORDER BY id`,
    [orderRow.id]
  );

  return mapOrderRow(orderRow, allocationRows.map(mapAllocationRow));
}

/** Looks up the order already associated with an Idempotency-Key, if any (ticket 13). */
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

/**
 * Claims an Idempotency-Key for `orderNumber` — meant to be called with the same `executor` (and
 * thus the same transaction) as the `createOrder` call it's claiming the key for, so the claim
 * and the order live or die together (ticket 13's "failed transaction does not consume
 * idempotency state").
 *
 * Throws `IdempotencyKeyConflictError` if the key was already claimed (by a concurrent
 * submission racing on the same key — the `idempotency_keys` PRIMARY KEY is what actually decides
 * the race, same pattern as `order_number_seq`/`decrementInventory`), rather than the raw
 * Postgres unique-violation error, so callers can handle it without depending on `pg` internals.
 */
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
