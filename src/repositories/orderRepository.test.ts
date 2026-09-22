import { expect } from "chai";
import sinon from "sinon";
import { IdempotencyKeyConflictError } from "../domain/errors";
import { toMoney } from "../domain/money";
import { Item } from "../domain/model/item";
import { OrderQuote } from "../domain/model/order";
import { QueryExecutor } from "../infrastructure/db/pool";
import * as orderRepository from "./orderRepository";

const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;

const defaultItem: Item = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Standard Unit",
  price: toMoney(15000),
  currency: "USD",
  weightKg: 0.365,
};

function buildQuote(overrides: Partial<OrderQuote> = {}): OrderQuote {
  return {
    quantity: 10,
    item: defaultItem,
    shippingAddress: { latitude: 40.7128, longitude: -74.006 },
    subtotal: toMoney(150000),
    discountRate: 0,
    discount: toMoney(0),
    amountAfterDiscount: toMoney(150000),
    totalWeightKg: 3.65,
    shippingCost: toMoney(500),
    total: toMoney(150500),
    currency: "USD",
    valid: true,
    invalidReasons: [],
    allocations: [
      { warehouseId: LOS_ANGELES_ID, quantity: 10, distanceKm: 1234.5, shippingCost: toMoney(500), currency: "USD" },
    ],
    ...overrides,
  };
}

function createFakeDb(): QueryExecutor {
  let seq = 0;
  let nextOrderId = 1;
  const ordersById = new Map<number, Record<string, unknown>>();
  const orderIdByNumber = new Map<string, number>();
  const allocationsByOrderId = new Map<number, Record<string, unknown>[]>();
  const idempotencyKeys = new Map<string, string>();

  const query = sinon.stub().callsFake(async (sql: string, params: unknown[] = []) => {
    const text = sql.trim();

    if (text.startsWith("SELECT nextval")) {
      seq += 1;
      return { rows: [{ seq: String(seq) }], rowCount: 1 };
    }

    if (text.startsWith("INSERT INTO orders")) {
      const [
        orderNumber,
        quantity,
        itemId,
        itemName,
        itemPrice,
        itemWeightKg,
        destLat,
        destLng,
        subtotal,
        discountRate,
        discount,
        amountAfterDiscount,
        shippingCost,
        total,
        currency,
      ] = params;
      const id = nextOrderId++;
      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      ordersById.set(id, {
        id,
        order_number: orderNumber,
        quantity,
        item_id: itemId,
        item_name: itemName,
        item_price: itemPrice,
        item_weight_kg: itemWeightKg,
        destination_latitude: destLat,
        destination_longitude: destLng,
        subtotal: subtotal,
        discount_rate: discountRate,
        discount: discount,
        amount_after_discount: amountAfterDiscount,
        shipping: shippingCost,
        total: total,
        currency,
        status: "CONFIRMED",
        created_at: createdAt,
      });
      orderIdByNumber.set(orderNumber as string, id);
      allocationsByOrderId.set(id, []);
      return { rows: [{ id, created_at: createdAt }], rowCount: 1 };
    }

    if (text.startsWith("INSERT INTO order_allocations")) {
      const [orderId, warehouseId, quantity, distanceKm, shippingCost, currency] = params as [
        number,
        ...unknown[]
      ];
      allocationsByOrderId.get(orderId)!.push({
        warehouse_id: warehouseId,
        quantity,
        distance_km: distanceKm,
        shipping: shippingCost,
        currency,
      });
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("SELECT id, order_number")) {
      const [orderNumber] = params as [string];
      const id = orderIdByNumber.get(orderNumber);
      if (id === undefined) return { rows: [], rowCount: 0 };
      return { rows: [ordersById.get(id)], rowCount: 1 };
    }

    if (text.startsWith("SELECT warehouse_id, quantity, distance_km")) {
      const [orderId] = params as [number];
      return { rows: allocationsByOrderId.get(orderId) ?? [], rowCount: 0 };
    }

    if (text.startsWith("SELECT order_number FROM idempotency_keys")) {
      const [key] = params as [string];
      const orderNumber = idempotencyKeys.get(key);
      return orderNumber ? { rows: [{ order_number: orderNumber }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (text.startsWith("INSERT INTO idempotency_keys")) {
      const [key, orderNumber] = params as [string, string];
      if (idempotencyKeys.has(key)) {
        const conflict = new Error("duplicate key value violates unique constraint") as Error & { code: string };
        conflict.code = "23505";
        throw conflict;
      }
      idempotencyKeys.set(key, orderNumber);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`fake db: unhandled query ${text}`);
  });

  return { query } as unknown as QueryExecutor;
}

describe("createOrder", () => {
  it("persists an order and returns it with a generated, human-readable order number", async () => {
    const db = createFakeDb();
    const quote = buildQuote();

    const order = await orderRepository.createOrder(quote, db);

    expect(order.orderNumber).to.match(/^ORD-\d{7}$/);
    expect(order.quantity).to.equal(quote.quantity);
    expect(order.item).to.deep.equal(defaultItem);
    expect(order.subtotal).to.equal(quote.subtotal);
    expect(order.discountRate).to.equal(quote.discountRate);
    expect(order.discount).to.equal(quote.discount);
    expect(order.amountAfterDiscount).to.equal(quote.amountAfterDiscount);
    expect(order.shippingCost).to.equal(quote.shippingCost);
    expect(order.total).to.equal(quote.total);
    expect(order.valid).to.equal(true);
    expect(new Date(order.createdAt).toString()).to.not.equal("Invalid Date");
  });

  it("persists a multi-warehouse allocation", async () => {
    const db = createFakeDb();
    const quote = buildQuote({
      quantity: 30,
      allocations: [
        { warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100, shippingCost: toMoney(730), currency: "USD" },
        { warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50, shippingCost: toMoney(182), currency: "USD" },
      ],
    });

    const order = await orderRepository.createOrder(quote, db);

    expect(order.allocations).to.have.lengthOf(2);
    expect(order.allocations).to.have.deep.members(quote.allocations);

    const fetched = await orderRepository.getOrderByNumber(order.orderNumber, db);
    expect(fetched?.allocations).to.have.lengthOf(2);
  });

  it("generates unique order numbers under concurrent creation", async () => {
    const db = createFakeDb();
    const attempts = Array.from({ length: 25 }, () => orderRepository.createOrder(buildQuote(), db));

    const orders = await Promise.all(attempts);

    const orderNumbers = orders.map((order) => order.orderNumber);
    expect(new Set(orderNumbers).size).to.equal(orderNumbers.length);
    for (const orderNumber of orderNumbers) {
      expect(orderNumber).to.match(/^ORD-\d{7}$/);
    }
  });

  it("preserves the exact pricing snapshot, independent of today's pricing rules", async () => {
    const db = createFakeDb();
    const quote = buildQuote({
      quantity: 10,
      subtotal: toMoney(999999),
      discountRate: 0.37,
      discount: toMoney(123456),
      amountAfterDiscount: toMoney(876543),
      shippingCost: toMoney(4321),
      total: toMoney(880864),
    });

    const order = await orderRepository.createOrder(quote, db);
    const fetched = await orderRepository.getOrderByNumber(order.orderNumber, db);

    expect(fetched?.subtotal).to.equal(999999);
    expect(fetched?.discountRate).to.equal(0.37);
    expect(fetched?.discount).to.equal(123456);
    expect(fetched?.amountAfterDiscount).to.equal(876543);
    expect(fetched?.shippingCost).to.equal(4321);
    expect(fetched?.total).to.equal(880864);
  });

  it("preserves the item snapshot, independent of the catalog's current values", async () => {
    const db = createFakeDb();
    const quote = buildQuote({
      item: { id: defaultItem.id, name: "Renamed Product", price: toMoney(99999), currency: "USD", weightKg: 1.23 },
    });

    const order = await orderRepository.createOrder(quote, db);
    const fetched = await orderRepository.getOrderByNumber(order.orderNumber, db);

    expect(fetched?.item).to.deep.equal({
      id: defaultItem.id,
      name: "Renamed Product",
      price: 99999,
      currency: "USD",
      weightKg: 1.23,
    });
  });
});

describe("getOrderByNumber", () => {
  it("retrieves the persisted snapshot, matching exactly what createOrder returned", async () => {
    const db = createFakeDb();
    const created = await orderRepository.createOrder(buildQuote(), db);

    const fetched = await orderRepository.getOrderByNumber(created.orderNumber, db);

    expect(fetched).to.deep.equal(created);
  });

  it("returns undefined for an unknown order number", async () => {
    const db = createFakeDb();
    const fetched = await orderRepository.getOrderByNumber("ORD-9999999", db);
    expect(fetched).to.equal(undefined);
  });
});

describe("recordIdempotencyKey / findOrderByIdempotencyKey", () => {
  it("returns undefined for a key that was never claimed", async () => {
    const db = createFakeDb();
    expect(await orderRepository.findOrderByIdempotencyKey("never-used", db)).to.equal(undefined);
  });

  it("finds the order a key was claimed for", async () => {
    const db = createFakeDb();
    const order = await orderRepository.createOrder(buildQuote(), db);
    await orderRepository.recordIdempotencyKey("key-1", order.orderNumber, db);

    const found = await orderRepository.findOrderByIdempotencyKey("key-1", db);

    expect(found).to.deep.equal(order);
  });

  it("rejects claiming the same key twice, for different orders, with a typed error", async () => {
    const db = createFakeDb();
    const first = await orderRepository.createOrder(buildQuote(), db);
    const second = await orderRepository.createOrder(buildQuote({ quantity: 20 }), db);

    await orderRepository.recordIdempotencyKey("dup-key", first.orderNumber, db);

    await expect(orderRepository.recordIdempotencyKey("dup-key", second.orderNumber, db)).to.be.rejectedWith(
      IdempotencyKeyConflictError
    );

    expect((await orderRepository.findOrderByIdempotencyKey("dup-key", db))?.orderNumber).to.equal(
      first.orderNumber
    );
  });

  it("allows the same order to be claimed under two different keys", async () => {
    const db = createFakeDb();
    const order = await orderRepository.createOrder(buildQuote(), db);

    await orderRepository.recordIdempotencyKey("key-a", order.orderNumber, db);
    await orderRepository.recordIdempotencyKey("key-b", order.orderNumber, db);

    expect((await orderRepository.findOrderByIdempotencyKey("key-a", db))?.orderNumber).to.equal(order.orderNumber);
    expect((await orderRepository.findOrderByIdempotencyKey("key-b", db))?.orderNumber).to.equal(order.orderNumber);
  });
});
