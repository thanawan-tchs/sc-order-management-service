import { expect } from "chai";
import sinon from "sinon";
import { submitOrder } from "./orderSubmissionService";
import { IdempotencyKeyReusedError, InsufficientStockError, OrderSubmissionError } from "../domain/errors";
import * as poolModule from "../infrastructure/db/pool";
import * as orderRepository from "../repositories/orderRepository";
import * as warehouseRepository from "../repositories/warehouseRepository";
import { SEED_WAREHOUSES } from "../config";
import { pointAtDistanceFrom } from "../../tests/helpers/geo";

const DESTINATION = { latitude: 0, longitude: 0 };
const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;
const SAO_PAULO_ID = 3;
const PARIS_ID = 4;
const WARSAW_ID = 5;
const HONG_KONG_ID = 6;
const ALL_WAREHOUSE_IDS = [LOS_ANGELES_ID, NEW_YORK_ID, SAO_PAULO_ID, PARIS_ID, WARSAW_ID, HONG_KONG_ID];
const DEFAULT_ITEM_ID = "11111111-1111-1111-1111-111111111111";

interface WarehouseRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}
interface ItemRow {
  id: string;
  name: string;
  price_cents: number;
  weight_kg: number;
}
interface OrderRowInternal {
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
  status: string;
  created_at: Date;
}
interface AllocationRowInternal {
  warehouse_id: number;
  quantity: number;
  distance_km: number;
  shipping_cents: number;
}

function createFakeDb() {
  const warehouses = new Map<number, WarehouseRow>(
    SEED_WAREHOUSES.map((w, index) => [
      index + 1,
      { id: index + 1, name: w.name, latitude: w.latitude, longitude: w.longitude },
    ])
  );
  const items = new Map<string, ItemRow>([
    [DEFAULT_ITEM_ID, { id: DEFAULT_ITEM_ID, name: "Standard Unit", price_cents: 15000, weight_kg: 0.365 }],
  ]);
  const stock = new Map<string, number>(
    SEED_WAREHOUSES.map((w, index) => [`${index + 1}:${DEFAULT_ITEM_ID}`, w.stock])
  );
  const ordersByNumber = new Map<string, OrderRowInternal>();
  const ordersById = new Map<number, OrderRowInternal>();
  const allocationsByOrderId = new Map<number, AllocationRowInternal[]>();
  const idempotencyKeys = new Map<string, string>();
  let seq = 0;
  let nextOrderId = 1;
  let nextItemId = 2;

  const locked = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  async function acquireLock(key: string): Promise<void> {
    if (!locked.has(key)) {
      locked.add(key);
      return;
    }
    await new Promise<void>((resolve) => {
      const list = waiters.get(key) ?? [];
      list.push(resolve);
      waiters.set(key, list);
    });
  }

  function releaseLock(key: string): void {
    const list = waiters.get(key);
    if (list && list.length > 0) {
      const next = list.shift()!;
      next(); // handoff: `key` stays locked, ownership transfers to the waiter
      return;
    }
    locked.delete(key);
  }

  function handleRead(text: string, params: unknown[]) {
    if (text.startsWith("SELECT id, name, latitude, longitude FROM warehouses ORDER BY id")) {
      const rows = [...warehouses.values()].sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith("SELECT id, name, price_cents, weight_kg FROM items WHERE id")) {
      const [id] = params as [string];
      const item = items.get(id);
      return item ? { rows: [item], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.startsWith("SELECT warehouse_id, item_id, stock FROM inventory")) {
      const [warehouseId, itemId] = params as [number, string];
      const value = stock.get(`${warehouseId}:${itemId}`) ?? 0;
      return { rows: [{ warehouse_id: warehouseId, item_id: itemId, stock: value }], rowCount: 1 };
    }
    if (text.startsWith("SELECT id, order_number")) {
      const [orderNumber] = params as [string];
      const row = ordersByNumber.get(orderNumber);
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
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
    if (text.startsWith("SELECT COUNT(*)::int AS count FROM orders")) {
      return { rows: [{ count: ordersByNumber.size }], rowCount: 1 };
    }
    return undefined;
  }

  function makeClient() {
    const heldLocks = new Set<string>();
    const pending: Array<() => void> = [];

    const query = sinon.stub().callsFake(async (sql: string, params: unknown[] = []) => {
      const text = sql.trim();

      if (text === "BEGIN") return { rows: [], rowCount: 0 };

      if (text === "COMMIT") {
        for (const apply of pending) apply();
        pending.length = 0;
        for (const key of heldLocks) releaseLock(key);
        heldLocks.clear();
        return { rows: [], rowCount: 0 };
      }

      if (text === "ROLLBACK") {
        pending.length = 0;
        for (const key of heldLocks) releaseLock(key);
        heldLocks.clear();
        return { rows: [], rowCount: 0 };
      }

      if (text.startsWith("UPDATE inventory SET stock = stock -")) {
        const [quantity, warehouseId, itemId] = params as [number, number, string];
        const key = `${warehouseId}:${itemId}`;
        await acquireLock(key);
        heldLocks.add(key);
        const current = stock.get(key) ?? 0;
        if (current >= quantity) {
          pending.push(() => stock.set(key, current - quantity));
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

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
          itemPriceCents,
          itemWeightKg,
          destLat,
          destLng,
          subtotal,
          discountRate,
          discountCents,
          amountAfterDiscount,
          shippingCents,
          totalCents,
        ] = params as [
          string,
          number,
          string,
          string,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number
        ];
        const id = nextOrderId++;
        const createdAt = new Date("2024-01-01T00:00:00.000Z");
        const row: OrderRowInternal = {
          id,
          order_number: orderNumber,
          quantity,
          item_id: itemId,
          item_name: itemName,
          item_price_cents: itemPriceCents,
          item_weight_kg: itemWeightKg,
          destination_latitude: destLat,
          destination_longitude: destLng,
          subtotal_cents: subtotal,
          discount_rate: discountRate,
          discount_cents: discountCents,
          amount_after_discount_cents: amountAfterDiscount,
          shipping_cents: shippingCents,
          total_cents: totalCents,
          status: "CONFIRMED",
          created_at: createdAt,
        };
        pending.push(() => {
          ordersByNumber.set(orderNumber, row);
          ordersById.set(id, row);
          allocationsByOrderId.set(id, []);
        });
        return { rows: [{ id, created_at: createdAt }], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO order_allocations")) {
        const [orderId, warehouseId, quantity, distanceKm, shippingCents] = params as [
          number,
          number,
          number,
          number,
          number
        ];
        pending.push(() => {
          const list = allocationsByOrderId.get(orderId) ?? [];
          list.push({ warehouse_id: warehouseId, quantity, distance_km: distanceKm, shipping_cents: shippingCents });
          allocationsByOrderId.set(orderId, list);
        });
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO idempotency_keys")) {
        const [key, orderNumber] = params as [string, string];
        const lockKey = `idem:${key}`;
        await acquireLock(lockKey);
        heldLocks.add(lockKey);
        if (idempotencyKeys.has(key)) {
          const conflict = new Error("duplicate key value violates unique constraint") as Error & { code: string };
          conflict.code = "23505";
          throw conflict;
        }
        pending.push(() => idempotencyKeys.set(key, orderNumber));
        return { rowCount: 1 };
      }

      const read = handleRead(text, params);
      if (read) return read;

      throw new Error(`fake db (client): unhandled query ${text}`);
    });

    return { query, release: sinon.stub() };
  }

  const poolQuery = sinon.stub().callsFake(async (sql: string, params: unknown[] = []) => {
    const text = sql.trim();

    if (text === "UPDATE warehouses SET latitude = $1, longitude = $2 WHERE id = $3") {
      const [latitude, longitude, id] = params as [number, number, number];
      const w = warehouses.get(id)!;
      warehouses.set(id, { ...w, latitude, longitude });
      return { rows: [], rowCount: 1 };
    }
    if (text === "UPDATE inventory SET stock = $1 WHERE warehouse_id = $2 AND item_id = $3") {
      const [value, warehouseId, itemId] = params as [number, number, string];
      stock.set(`${warehouseId}:${itemId}`, value);
      return { rows: [], rowCount: 1 };
    }
    if (text === "UPDATE inventory SET stock = 0 WHERE warehouse_id = $1 AND item_id = $2") {
      const [warehouseId, itemId] = params as [number, string];
      stock.set(`${warehouseId}:${itemId}`, 0);
      return { rows: [], rowCount: 1 };
    }
    if (text === "INSERT INTO items (name, price_cents, weight_kg) VALUES ($1, $2, $3) RETURNING id") {
      const [name, priceCents, weightKg] = params as [string, number, number];
      const id = `item-${nextItemId++}`;
      items.set(id, { id, name, price_cents: priceCents, weight_kg: weightKg });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (text === "INSERT INTO inventory (warehouse_id, item_id, stock) VALUES ($1, $2, $3)") {
      const [warehouseId, itemId, value] = params as [number, string, number];
      stock.set(`${warehouseId}:${itemId}`, value);
      return { rows: [], rowCount: 1 };
    }

    const read = handleRead(text, params);
    if (read) return read;

    throw new Error(`fake db (pool): unhandled query ${text}`);
  });

  return {
    pool: { query: poolQuery, connect: async () => makeClient() },
  };
}

describe("submitOrder", () => {
let fakeDb: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  fakeDb = createFakeDb();
  sinon.stub(poolModule, "getPool").returns(fakeDb.pool as never);
});

afterEach(() => {
  sinon.restore();
});

async function repositionWarehouse(
  id: number,
  origin: { latitude: number; longitude: number },
  stockAmount: number,
  distanceKm: number
): Promise<void> {
  const { latitude, longitude } = pointAtDistanceFrom(origin, distanceKm);
  const pool = poolModule.getPool();
  await pool.query("UPDATE warehouses SET latitude = $1, longitude = $2 WHERE id = $3", [latitude, longitude, id]);
  await pool.query("UPDATE inventory SET stock = $1 WHERE warehouse_id = $2 AND item_id = $3", [
    stockAmount,
    id,
    DEFAULT_ITEM_ID,
  ]);
}

async function zeroOutStock(ids: number[]): Promise<void> {
  const pool = poolModule.getPool();
  for (const id of ids) {
    await pool.query("UPDATE inventory SET stock = 0 WHERE warehouse_id = $1 AND item_id = $2", [id, DEFAULT_ITEM_ID]);
  }
}

async function countOrders(): Promise<number> {
  const { rows } = await poolModule.getPool().query<{ count: number }>("SELECT COUNT(*)::int AS count FROM orders");
  return Number(rows[0].count);
}

describe("submitOrder — successful submission", () => {
  it("fulfills entirely from a single warehouse and decrements its stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    const order = await submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 20, shippingAddress: DESTINATION });

    expect(order.orderNumber).to.match(/^ORD-\d{7}$/);
    expect(order.allocations).to.have.lengthOf(1);
    expect(order.allocations[0]).to.include({ warehouseId: LOS_ANGELES_ID, quantity: 20 });
    expect(order.valid).to.equal(true);

    const inventory = await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID);
    expect(inventory?.stock).to.equal(80);

    const fetched = await orderRepository.getOrderByNumber(order.orderNumber);
    expect(fetched).to.deep.equal(order);
  });

  it("splits across multiple warehouses and decrements each of their stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 15, 10);
    await repositionWarehouse(NEW_YORK_ID, DESTINATION, 100, 20);

    const order = await submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 20, shippingAddress: DESTINATION });

    expect(order.allocations).to.have.lengthOf(2);
    expect(order.allocations[0]).to.include({ warehouseId: LOS_ANGELES_ID, quantity: 15 });
    expect(order.allocations[1]).to.include({ warehouseId: NEW_YORK_ID, quantity: 5 });

    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(0);
    expect((await warehouseRepository.getInventory(NEW_YORK_ID, DEFAULT_ITEM_ID))?.stock).to.equal(95);
  });
});

describe("submitOrder — invalid orders never touch inventory or create a row", () => {
  it("rejects insufficient stock and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 5, 10);

    const before = await countOrders();

    await expect(
      submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 100, shippingAddress: DESTINATION })
    ).to.be.rejectedWith(OrderSubmissionError);

    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(5);
    expect(await countOrders()).to.equal(before);
  });

  it("rejects shipping cost exceeding 15% and leaves inventory untouched", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 10000);

    const before = await countOrders();

    let caught: unknown;
    try {
      await submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 1, shippingAddress: DESTINATION });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(OrderSubmissionError);
    expect((caught as OrderSubmissionError).invalidReasons).to.deep.equal(["SHIPPING_COST_EXCEEDS_15_PERCENT"]);
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(10);
    expect(await countOrders()).to.equal(before);
  });
});

describe("submitOrder — concurrency", () => {
  it("under an inventory conflict, exactly one of two racing submissions succeeds and the other rolls back cleanly", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 10);

    const before = await countOrders();

    const results = await Promise.allSettled([
      submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 8, shippingAddress: DESTINATION }),
      submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 8, shippingAddress: DESTINATION }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).to.have.lengthOf(1);
    expect(rejected).to.have.lengthOf(1);
    if (rejected[0].status === "rejected") {
      const isExpectedErrorType =
        rejected[0].reason instanceof InsufficientStockError || rejected[0].reason instanceof OrderSubmissionError;
      expect(isExpectedErrorType).to.equal(true);
    }

    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(2);
    expect(await countOrders()).to.equal(before + 1);
  });

  it(
    "rolls back the WHOLE transaction — including an earlier line's already-applied " +
      "decrement — when a later allocation line loses a race for shared stock",
    async () => {
      const destination1 = { latitude: 0, longitude: 0 };
      const destination2 = { latitude: 0, longitude: 90 };

      await zeroOutStock(ALL_WAREHOUSE_IDS);
      await repositionWarehouse(LOS_ANGELES_ID, destination1, 10, 10); // order1's primary
      await repositionWarehouse(NEW_YORK_ID, destination2, 10, 10); // order2's primary
      await repositionWarehouse(SAO_PAULO_ID, { latitude: 45, longitude: 45 }, 5, 1); // shared overflow

      const before = await countOrders();

      const results = await Promise.allSettled([
        submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 13, shippingAddress: destination1 }),
        submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 13, shippingAddress: destination2 }),
      ]);

      const fulfilledIndex = results.findIndex((r) => r.status === "fulfilled");
      const rejectedIndex = results.findIndex((r) => r.status === "rejected");
      expect(fulfilledIndex).to.not.equal(-1);
      expect(rejectedIndex).to.not.equal(-1);

      const rejectedResult = results[rejectedIndex];
      if (rejectedResult.status === "rejected") {
        const isExpectedErrorType =
          rejectedResult.reason instanceof InsufficientStockError ||
          rejectedResult.reason instanceof OrderSubmissionError;
        expect(isExpectedErrorType).to.equal(true);
      }

      const winnerPrimaryId = fulfilledIndex === 0 ? LOS_ANGELES_ID : NEW_YORK_ID;
      const loserPrimaryId = fulfilledIndex === 0 ? NEW_YORK_ID : LOS_ANGELES_ID;
      expect((await warehouseRepository.getInventory(winnerPrimaryId, DEFAULT_ITEM_ID))?.stock).to.equal(0);
      expect((await warehouseRepository.getInventory(loserPrimaryId, DEFAULT_ITEM_ID))?.stock).to.equal(10);
      expect((await warehouseRepository.getInventory(SAO_PAULO_ID, DEFAULT_ITEM_ID))?.stock).to.equal(2);
      expect(await countOrders()).to.equal(before + 1);
    }
  );
});

describe("submitOrder — idempotency (ticket 13)", () => {
  it("returns the same order for the same key submitted twice, without decrementing inventory twice", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    const first = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-key-1",
    });
    const second = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-key-1",
    });

    expect(second).to.deep.equal(first);
    expect(await countOrders()).to.equal(1);
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(80);
  });

  it("treats requests without an idempotency key as always distinct", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    const first = await submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 5, shippingAddress: DESTINATION });
    const second = await submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 5, shippingAddress: DESTINATION });

    expect(second.orderNumber).to.not.equal(first.orderNumber);
    expect(await countOrders()).to.equal(2);
  });

  it("under a concurrent submission with the same key, exactly one order is created and both callers receive it", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    const [a, b] = await Promise.all([
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "concurrent-key",
      }),
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "concurrent-key",
      }),
    ]);

    expect(a.orderNumber).to.equal(b.orderNumber);
    expect(await countOrders()).to.equal(1);
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(80);
  });

  it("does not consume the idempotency key on a failed submission — a retry with the same key can still succeed", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);

    await expect(
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "retry-after-failure",
      })
    ).to.be.rejectedWith(OrderSubmissionError);
    expect(await orderRepository.findOrderByIdempotencyKey("retry-after-failure")).to.equal(undefined);

    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);
    const order = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "retry-after-failure",
    });

    expect(order.quantity).to.equal(20);
    expect(await countOrders()).to.equal(1);
    expect((await orderRepository.findOrderByIdempotencyKey("retry-after-failure"))?.orderNumber).to.equal(
      order.orderNumber
    );
  });

  it("fulfills a request for exactly the available stock", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 8, 10);

    const order = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 8,
      shippingAddress: DESTINATION,
      idempotencyKey: "exact-stock",
    });

    expect(order.allocations).to.have.lengthOf(1);
    expect(order.allocations[0]).to.include({ warehouseId: LOS_ANGELES_ID, quantity: 8 });
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(0);
  });

  it("different idempotency keys still correctly compete for the same limited stock (one wins, one fails)", async () => {
    await zeroOutStock(ALL_WAREHOUSE_IDS);
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 10, 10);

    const results = await Promise.allSettled([
      submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 8, shippingAddress: DESTINATION, idempotencyKey: "key-a" }),
      submitOrder({ itemId: DEFAULT_ITEM_ID, quantity: 8, shippingAddress: DESTINATION, idempotencyKey: "key-b" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).to.have.lengthOf(1);
    expect(rejected).to.have.lengthOf(1);
    if (rejected[0].status === "rejected") {
      const isExpectedErrorType =
        rejected[0].reason instanceof InsufficientStockError || rejected[0].reason instanceof OrderSubmissionError;
      expect(isExpectedErrorType).to.equal(true);
    }
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(2);
  });
});

describe("submitOrder — idempotency key reused for a different request (ticket 15)", () => {
  it("rejects a key reused with a different quantity", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-1",
    });

    await expect(
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 21,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-1",
      })
    ).to.be.rejectedWith(IdempotencyKeyReusedError);

    expect(await countOrders()).to.equal(1);
    expect((await warehouseRepository.getInventory(LOS_ANGELES_ID, DEFAULT_ITEM_ID))?.stock).to.equal(80);
  });

  it("rejects a key reused with a different shipping address", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);
    const otherAddress = { latitude: 10, longitude: 10 };

    await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-2",
    });

    await expect(
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 20,
        shippingAddress: otherAddress,
        idempotencyKey: "reused-key-2",
      })
    ).to.be.rejectedWith(IdempotencyKeyReusedError);

    expect(await countOrders()).to.equal(1);
  });

  it("rejects a key reused with a different itemId", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);
    const pool = poolModule.getPool();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO items (name, price_cents, weight_kg) VALUES ($1, $2, $3) RETURNING id",
      ["Second Item", 5000, 0.5]
    );
    const otherItemId = rows[0].id;
    await pool.query("INSERT INTO inventory (warehouse_id, item_id, stock) VALUES ($1, $2, $3)", [
      LOS_ANGELES_ID,
      otherItemId,
      100,
    ]);

    await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-item",
    });

    await expect(
      submitOrder({
        itemId: otherItemId,
        quantity: 20,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-item",
      })
    ).to.be.rejectedWith(IdempotencyKeyReusedError);

    expect(await countOrders()).to.equal(1);
  });

  it("still accepts a genuinely matching retry (same quantity and address) after a mismatch was rejected", async () => {
    await repositionWarehouse(LOS_ANGELES_ID, DESTINATION, 100, 10);

    const original = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-3",
    });
    await expect(
      submitOrder({
        itemId: DEFAULT_ITEM_ID,
        quantity: 99,
        shippingAddress: DESTINATION,
        idempotencyKey: "reused-key-3",
      })
    ).to.be.rejectedWith(IdempotencyKeyReusedError);

    const matchingRetry = await submitOrder({
      itemId: DEFAULT_ITEM_ID,
      quantity: 20,
      shippingAddress: DESTINATION,
      idempotencyKey: "reused-key-3",
    });

    expect(matchingRetry).to.deep.equal(original);
    expect(await countOrders()).to.equal(1);
  });
});
});
