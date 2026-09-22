import exception from "@domain/errors";
import { Currency, toMoney } from "@domain/money";
import { Order, OrderQuote, OrderStatus } from "@domain/model/order";
import { ShippingAllocation } from "@domain/model/shipping";
import {
  Order as OrderRecord,
  OrderAllocation as OrderAllocationRecord,
  Prisma,
} from "@generated/prisma/client";
import { QueryExecutor, getPrismaClient } from "@infrastructure/db/prismaClient";

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION;
}

type OrderWithAllocations = OrderRecord & { allocations: OrderAllocationRecord[] };

function mapAllocation(record: OrderAllocationRecord): ShippingAllocation {
  return {
    warehouseId: record.warehouseId,
    quantity: record.quantity,
    distanceKm: record.distanceKm,
    shippingCost: toMoney(record.shipping),
    currency: record.currency as Currency,
  };
}

function mapOrder(record: OrderWithAllocations): Order {
  return {
    quantity: record.quantity,
    item: {
      id: record.itemId,
      name: record.itemName,
      price: toMoney(record.itemPrice),
      currency: record.currency as Currency,
      weightKg: record.itemWeightKg,
    },
    shippingAddress: { latitude: record.destinationLatitude, longitude: record.destinationLongitude },
    subtotal: toMoney(record.subtotal),
    discountRate: record.discountRate,
    discount: toMoney(record.discount),
    amountAfterDiscount: toMoney(record.amountAfterDiscount),
    totalWeightKg: record.quantity * record.itemWeightKg,
    shippingCost: toMoney(record.shipping),
    total: toMoney(record.total),
    currency: record.currency as Currency,
    valid: true,
    invalidReasons: [],
    allocations: record.allocations.map(mapAllocation),
    orderNumber: record.orderNumber,
    status: record.status as OrderStatus,
    createdAt: record.createdAt.toISOString(),
  };
}

async function generateOrderNumber(executor: QueryExecutor): Promise<string> {
  const rows = await executor.$queryRaw<{ seq: bigint }[]>`SELECT nextval('order_number_seq') AS seq`;
  return `ORD-${rows[0].seq.toString().padStart(7, "0")}`;
}

const INITIAL_ORDER_STATUS: OrderStatus = "CONFIRMED";

export async function createOrder(quote: OrderQuote, executor: QueryExecutor = getPrismaClient()): Promise<Order> {
  const orderNumber = await generateOrderNumber(executor);

  const record = await executor.order.create({
    data: {
      orderNumber,
      quantity: quote.quantity,
      itemId: quote.item.id,
      itemName: quote.item.name,
      itemPrice: quote.item.price,
      itemWeightKg: quote.item.weightKg,
      destinationLatitude: quote.shippingAddress.latitude,
      destinationLongitude: quote.shippingAddress.longitude,
      subtotal: quote.subtotal,
      discountRate: quote.discountRate,
      discount: quote.discount,
      amountAfterDiscount: quote.amountAfterDiscount,
      shipping: quote.shippingCost,
      total: quote.total,
      currency: quote.currency,
      status: INITIAL_ORDER_STATUS,
      allocations: {
        create: quote.allocations.map((allocation) => ({
          warehouseId: allocation.warehouseId,
          quantity: allocation.quantity,
          distanceKm: allocation.distanceKm,
          shipping: allocation.shippingCost,
          currency: allocation.currency,
        })),
      },
    },
    include: { allocations: { orderBy: { id: "asc" } } },
  });

  return mapOrder(record);
}

export async function getOrderByNumber(
  orderNumber: string,
  executor: QueryExecutor = getPrismaClient()
): Promise<Order | undefined> {
  const record = await executor.order.findUnique({
    where: { orderNumber },
    include: { allocations: { orderBy: { id: "asc" } } },
  });
  return record ? mapOrder(record) : undefined;
}

export async function findOrderByIdempotencyKey(
  idempotencyKey: string,
  executor: QueryExecutor = getPrismaClient()
): Promise<Order | undefined> {
  const record = await executor.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (!record) return undefined;

  return getOrderByNumber(record.orderNumber, executor);
}

export async function recordIdempotencyKey(
  idempotencyKey: string,
  orderNumber: string,
  executor: QueryExecutor = getPrismaClient()
): Promise<void> {
  try {
    await executor.idempotencyKey.create({ data: { key: idempotencyKey, orderNumber } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new exception.IdempotencyKeyConflictError(idempotencyKey);
    }
    throw error;
  }
}

export default { createOrder, getOrderByNumber, findOrderByIdempotencyKey, recordIdempotencyKey };
