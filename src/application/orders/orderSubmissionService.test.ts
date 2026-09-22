import { expect } from "chai";
import sinon from "sinon";
import { submitOrder } from "./orderSubmissionService";
import exception, { OrderSubmissionError } from "@domain/errors";
import { toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import { Order } from "@domain/model/order";
import * as prismaClientModule from "@infrastructure/db/prismaClient";
import itemRepository from "@repositories/itemRepository";
import orderRepository from "@repositories/orderRepository";
import warehouseRepository from "@repositories/warehouseRepository";
import { KeyMutex } from "@tests/helpers/keyMutex";
import { pointAtDistanceFrom } from "@tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;
const SAO_PAULO_ID = 3;
const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const ITEM: Item = { id: ITEM_ID, name: "Standard Unit", price: toMoney(15000), currency: "USD", weightKg: 0.365 };

function warehouseAt(id: number, distanceKm: number, origin: { latitude: number; longitude: number } = DESTINATION) {
  const { latitude, longitude } = pointAtDistanceFrom(origin, distanceKm);
  return { id, name: `Warehouse ${id}`, latitude, longitude };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    quantity: 1,
    item: ITEM,
    shippingAddress: DESTINATION,
    subtotal: toMoney(15000),
    discountRate: 0,
    discount: toMoney(0),
    amountAfterDiscount: toMoney(15000),
    totalWeightKg: 0.365,
    shippingCost: toMoney(0),
    total: toMoney(15000),
    currency: "USD",
    valid: true,
    invalidReasons: [],
    allocations: [],
    orderNumber: "ORD-0000001",
    status: "CONFIRMED",
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function stubPool(): void {
  sinon.stub(prismaClientModule, "getPrismaClient").returns({
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as never);
}

interface TransactionalClient {
  onCommit(fn: () => void): void;
  onSettle(fn: () => void): void;
}

function stubTransactionalPool(): void {
  sinon.stub(prismaClientModule, "getPrismaClient").returns({
    $transaction: async (fn: (tx: TransactionalClient) => Promise<unknown>) => {
      const onCommitCallbacks: Array<() => void> = [];
      const onSettleCallbacks: Array<() => void> = [];
      const client: TransactionalClient = {
        onCommit: (fn) => onCommitCallbacks.push(fn),
        onSettle: (fn) => onSettleCallbacks.push(fn),
      };
      try {
        const result = await fn(client);
        onCommitCallbacks.forEach((fn) => fn());
        onSettleCallbacks.forEach((fn) => fn());
        return result;
      } catch (error) {
        onSettleCallbacks.forEach((fn) => fn());
        throw error;
      }
    },
  } as never);
}

afterEach(() => {
  sinon.restore();
});

describe("submitOrder — successful submission", () => {
  it("fulfills entirely from a single warehouse and decrements its stock", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    const expectedOrder = buildOrder({
      quantity: 20,
      allocations: [
        { warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 10, shippingCost: toMoney(73), currency: "USD" },
      ],
    });
    sinon.stub(orderRepository, "createOrder").resolves(expectedOrder);

    const order = await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION });

    expect(decrementStub.calledOnceWith(LOS_ANGELES_ID, ITEM_ID, 20)).to.equal(true);
    expect(order).to.deep.equal(expectedOrder);
  });

  it("splits across multiple warehouses and decrements each of their stock", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10), warehouseAt(NEW_YORK_ID, 20)]);
    sinon.stub(warehouseRepository, "getInventory").callsFake(async (warehouseId: number) => ({
      warehouseId,
      itemId: ITEM_ID,
      stock: warehouseId === LOS_ANGELES_ID ? 15 : 100,
    }));
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => buildOrder({ quantity: quote.quantity, allocations: quote.allocations }));

    await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION });

    expect(decrementStub.firstCall.calledWith(LOS_ANGELES_ID, ITEM_ID, 15)).to.equal(true);
    expect(decrementStub.secondCall.calledWith(NEW_YORK_ID, ITEM_ID, 5)).to.equal(true);
  });
});

describe("submitOrder — invalid orders never touch inventory or create a row", () => {
  it("rejects insufficient stock and leaves inventory untouched", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 5 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    const createOrderStub = sinon.stub(orderRepository, "createOrder").resolves(buildOrder());

    await expect(submitOrder({ itemId: ITEM_ID, quantity: 100, shippingAddress: DESTINATION })).to.be.rejectedWith(
      exception.OrderSubmissionError
    );

    expect(decrementStub.called).to.equal(false);
    expect(createOrderStub.called).to.equal(false);
  });

  it("rejects shipping cost exceeding 15% and leaves inventory untouched", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10000)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 10 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    const createOrderStub = sinon.stub(orderRepository, "createOrder").resolves(buildOrder());

    let caught: unknown;
    try {
      await submitOrder({ itemId: ITEM_ID, quantity: 1, shippingAddress: DESTINATION });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(exception.OrderSubmissionError);
    expect((caught as OrderSubmissionError).invalidReasons).to.deep.equal(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
    expect(decrementStub.called).to.equal(false);
    expect(createOrderStub.called).to.equal(false);
  });
});

describe("submitOrder — concurrency", () => {
  it("under an inventory conflict, exactly one of two racing submissions succeeds and the other rolls back cleanly", async () => {
    stubTransactionalPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);

    const stock: Record<number, number> = { [LOS_ANGELES_ID]: 10 };
    const stockLock = new KeyMutex();
    sinon.stub(warehouseRepository, "getInventory").callsFake(async (warehouseId: number) => ({
      warehouseId,
      itemId: ITEM_ID,
      stock: stock[warehouseId],
    }));
    sinon
      .stub(warehouseRepository, "decrementInventory")
      .callsFake(async (warehouseId: number, itemId: string, quantity: number, executor: unknown) => {
        const client = executor as TransactionalClient;
        const release = await stockLock.acquire(`${warehouseId}:${itemId}`);
        const current = stock[warehouseId];
        if (current < quantity) {
          release();
          throw new exception.InsufficientStockError(warehouseId, quantity);
        }
        client.onCommit(() => {
          stock[warehouseId] = current - quantity;
        });
        client.onSettle(release);
      });
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => buildOrder({ quantity: quote.quantity, allocations: quote.allocations }));

    const results = await Promise.allSettled([
      submitOrder({ itemId: ITEM_ID, quantity: 8, shippingAddress: DESTINATION }),
      submitOrder({ itemId: ITEM_ID, quantity: 8, shippingAddress: DESTINATION }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).to.have.lengthOf(1);
    expect(rejected).to.have.lengthOf(1);
    if (rejected[0].status === "rejected") {
      const isExpectedErrorType =
        rejected[0].reason instanceof exception.InsufficientStockError || rejected[0].reason instanceof exception.OrderSubmissionError;
      expect(isExpectedErrorType).to.equal(true);
    }
    expect(stock[LOS_ANGELES_ID]).to.equal(2);
  });

  it(
    "rolls back the WHOLE transaction — including an earlier line's already-applied " +
      "decrement — when a later allocation line loses a race for shared stock",
    async () => {
      stubTransactionalPool();
      const destination1 = { latitude: 0, longitude: 0 };
      const destination2 = { latitude: 0, longitude: 90 };
      const sharedOrigin = { latitude: 45, longitude: 45 };

      sinon.stub(itemRepository, "getItem").resolves(ITEM);
      sinon.stub(warehouseRepository, "getAllWarehouses").resolves([
        warehouseAt(LOS_ANGELES_ID, 10, destination1),
        warehouseAt(NEW_YORK_ID, 10, destination2),
        warehouseAt(SAO_PAULO_ID, 1, sharedOrigin),
      ]);

      const stock: Record<number, number> = { [LOS_ANGELES_ID]: 10, [NEW_YORK_ID]: 10, [SAO_PAULO_ID]: 5 };
      const stockLock = new KeyMutex();
      sinon.stub(warehouseRepository, "getInventory").callsFake(async (warehouseId: number) => ({
        warehouseId,
        itemId: ITEM_ID,
        stock: stock[warehouseId],
      }));
      sinon
        .stub(warehouseRepository, "decrementInventory")
        .callsFake(async (warehouseId: number, itemId: string, quantity: number, executor: unknown) => {
          const client = executor as TransactionalClient;
          const release = await stockLock.acquire(`${warehouseId}:${itemId}`);
          const current = stock[warehouseId];
          if (current < quantity) {
            release();
            throw new exception.InsufficientStockError(warehouseId, quantity);
          }
          client.onCommit(() => {
            stock[warehouseId] = current - quantity;
          });
          client.onSettle(release);
        });
      sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => buildOrder({ quantity: quote.quantity, allocations: quote.allocations }));

      const results = await Promise.allSettled([
        submitOrder({ itemId: ITEM_ID, quantity: 13, shippingAddress: destination1 }),
        submitOrder({ itemId: ITEM_ID, quantity: 13, shippingAddress: destination2 }),
      ]);

      const fulfilledIndex = results.findIndex((r) => r.status === "fulfilled");
      const rejectedIndex = results.findIndex((r) => r.status === "rejected");
      expect(fulfilledIndex).to.not.equal(-1);
      expect(rejectedIndex).to.not.equal(-1);

      const rejectedResult = results[rejectedIndex];
      if (rejectedResult.status === "rejected") {
        const isExpectedErrorType =
          rejectedResult.reason instanceof exception.InsufficientStockError ||
          rejectedResult.reason instanceof exception.OrderSubmissionError;
        expect(isExpectedErrorType).to.equal(true);
      }

      const winnerPrimaryId = fulfilledIndex === 0 ? LOS_ANGELES_ID : NEW_YORK_ID;
      const loserPrimaryId = fulfilledIndex === 0 ? NEW_YORK_ID : LOS_ANGELES_ID;
      expect(stock[winnerPrimaryId]).to.equal(0);
      expect(stock[loserPrimaryId]).to.equal(10);
      expect(stock[SAO_PAULO_ID]).to.equal(2);
    }
  );
});

describe("submitOrder — idempotency (ticket 13)", () => {
  it("returns the same order for the same key submitted twice, without decrementing inventory twice", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    const createOrderStub = sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, allocations: quote.allocations });
      return claimedOrder;
    });

    const first = await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "retry-key-1" });
    const second = await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "retry-key-1" });

    expect(second).to.deep.equal(first);
    expect(createOrderStub.callCount).to.equal(1);
    expect(decrementStub.callCount).to.equal(1);
  });

  it("treats requests without an idempotency key as always distinct", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();
    let orderCount = 0;
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) =>
      buildOrder({ quantity: quote.quantity, allocations: quote.allocations, orderNumber: `ORD-${String(++orderCount).padStart(7, "0")}` })
    );

    const first = await submitOrder({ itemId: ITEM_ID, quantity: 5, shippingAddress: DESTINATION });
    const second = await submitOrder({ itemId: ITEM_ID, quantity: 5, shippingAddress: DESTINATION });

    expect(second.orderNumber).to.not.equal(first.orderNumber);
  });

  it("under a concurrent submission with the same key, exactly one order is created and both callers receive it", async () => {
    stubTransactionalPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();

    const ordersByNumber = new Map<string, Order>();
    let nextOrderNumber = 1;
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      const order = buildOrder({
        quantity: quote.quantity,
        allocations: quote.allocations,
        orderNumber: `ORD-${String(nextOrderNumber++).padStart(7, "0")}`,
      });
      ordersByNumber.set(order.orderNumber, order);
      return order;
    });

    const claimedKeys = new Map<string, string>();
    const keyLock = new KeyMutex();
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async (key: string) => {
      const orderNumber = claimedKeys.get(key);
      return orderNumber ? ordersByNumber.get(orderNumber) : undefined;
    });
    sinon
      .stub(orderRepository, "recordIdempotencyKey")
      .callsFake(async (key: string, orderNumber: string, executor: unknown) => {
        const client = executor as TransactionalClient;
        const release = await keyLock.acquire(key);
        if (claimedKeys.has(key)) {
          release();
          throw new exception.IdempotencyKeyConflictError(key);
        }
        client.onCommit(() => claimedKeys.set(key, orderNumber));
        client.onSettle(release);
      });

    const [a, b] = await Promise.all([
      submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "concurrent-key" }),
      submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "concurrent-key" }),
    ]);

    expect(a.orderNumber).to.equal(b.orderNumber);
  });

  it("does not consume the idempotency key on a failed submission — a retry with the same key can still succeed", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    const inventoryStub = sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 0 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, allocations: quote.allocations });
      return claimedOrder;
    });

    await expect(
      submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "retry-after-failure" })
    ).to.be.rejectedWith(exception.OrderSubmissionError);
    expect(claimedOrder).to.equal(undefined);

    inventoryStub.resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    const order = await submitOrder({
      itemId: ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-after-failure",
    });

    expect(order.quantity).to.equal(20);
    expect(decrementStub.callCount).to.equal(1);
  });

  it("fulfills a request for exactly the available stock", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 8 });
    const decrementStub = sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").resolves(undefined);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => buildOrder({ quantity: quote.quantity, allocations: quote.allocations }));

    const order = await submitOrder({ itemId: ITEM_ID, quantity: 8, shippingAddress: DESTINATION, idempotencyKey: "exact-stock" });

    expect(decrementStub.calledOnceWith(LOS_ANGELES_ID, ITEM_ID, 8)).to.equal(true);
    expect(order.allocations).to.have.lengthOf(1);
    expect(order.allocations[0]).to.include({ warehouseId: LOS_ANGELES_ID, quantity: 8 });
  });

  it("different idempotency keys still correctly compete for the same limited stock (one wins, one fails)", async () => {
    stubTransactionalPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").resolves(undefined);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => buildOrder({ quantity: quote.quantity, allocations: quote.allocations }));

    const stock: Record<number, number> = { [LOS_ANGELES_ID]: 10 };
    const stockLock = new KeyMutex();
    sinon.stub(warehouseRepository, "getInventory").callsFake(async (warehouseId: number) => ({
      warehouseId,
      itemId: ITEM_ID,
      stock: stock[warehouseId],
    }));
    sinon
      .stub(warehouseRepository, "decrementInventory")
      .callsFake(async (warehouseId: number, itemId: string, quantity: number, executor: unknown) => {
        const client = executor as TransactionalClient;
        const release = await stockLock.acquire(`${warehouseId}:${itemId}`);
        const current = stock[warehouseId];
        if (current < quantity) {
          release();
          throw new exception.InsufficientStockError(warehouseId, quantity);
        }
        client.onCommit(() => {
          stock[warehouseId] = current - quantity;
        });
        client.onSettle(release);
      });

    const results = await Promise.allSettled([
      submitOrder({ itemId: ITEM_ID, quantity: 8, shippingAddress: DESTINATION, idempotencyKey: "key-a" }),
      submitOrder({ itemId: ITEM_ID, quantity: 8, shippingAddress: DESTINATION, idempotencyKey: "key-b" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).to.have.lengthOf(1);
    expect(rejected).to.have.lengthOf(1);
    expect(stock[LOS_ANGELES_ID]).to.equal(2);
  });
});

describe("submitOrder — idempotency key reused for a different request (ticket 15)", () => {
  it("rejects a key reused with a different quantity", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, allocations: quote.allocations });
      return claimedOrder;
    });

    await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-1" });

    await expect(
      submitOrder({ itemId: ITEM_ID, quantity: 21, shippingAddress: DESTINATION, idempotencyKey: "reused-key-1" })
    ).to.be.rejectedWith(exception.IdempotencyKeyReusedError);
  });

  it("rejects a key reused with a different shipping address", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, shippingAddress: quote.shippingAddress, allocations: quote.allocations });
      return claimedOrder;
    });

    await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-2" });

    await expect(
      submitOrder({
        itemId: ITEM_ID,
        quantity: 20,
        shippingAddress: { latitude: 10, longitude: 10 },
        idempotencyKey: "reused-key-2",
      })
    ).to.be.rejectedWith(exception.IdempotencyKeyReusedError);
  });

  it("rejects a key reused with a different itemId", async () => {
    stubPool();
    const otherItem: Item = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Second Item",
      price: toMoney(5000),
      currency: "USD",
      weightKg: 0.5,
    };
    sinon.stub(itemRepository, "getItem").callsFake(async (id: string) => (id === ITEM_ID ? ITEM : otherItem));
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, item: quote.item, allocations: quote.allocations });
      return claimedOrder;
    });

    await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-item" });

    await expect(
      submitOrder({ itemId: otherItem.id, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-item" })
    ).to.be.rejectedWith(exception.IdempotencyKeyReusedError);
  });

  it("still accepts a genuinely matching retry (same quantity and address) after a mismatch was rejected", async () => {
    stubPool();
    sinon.stub(itemRepository, "getItem").resolves(ITEM);
    sinon.stub(warehouseRepository, "getAllWarehouses").resolves([warehouseAt(LOS_ANGELES_ID, 10)]);
    sinon.stub(warehouseRepository, "getInventory").resolves({ warehouseId: LOS_ANGELES_ID, itemId: ITEM_ID, stock: 100 });
    sinon.stub(warehouseRepository, "decrementInventory").resolves();
    sinon.stub(orderRepository, "recordIdempotencyKey").resolves();

    let claimedOrder: Order | undefined;
    sinon.stub(orderRepository, "findOrderByIdempotencyKey").callsFake(async () => claimedOrder);
    sinon.stub(orderRepository, "createOrder").callsFake(async (quote) => {
      claimedOrder = buildOrder({ quantity: quote.quantity, allocations: quote.allocations });
      return claimedOrder;
    });

    const original = await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-3" });

    await expect(
      submitOrder({ itemId: ITEM_ID, quantity: 99, shippingAddress: DESTINATION, idempotencyKey: "reused-key-3" })
    ).to.be.rejectedWith(exception.IdempotencyKeyReusedError);

    const matchingRetry = await submitOrder({ itemId: ITEM_ID, quantity: 20, shippingAddress: DESTINATION, idempotencyKey: "reused-key-3" });

    expect(matchingRetry).to.deep.equal(original);
  });
});
