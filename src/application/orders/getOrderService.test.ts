import { expect } from "chai";
import sinon from "sinon";
import { getOrder } from "./getOrderService";
import { toMoney } from "@domain/money";
import { Item } from "@domain/model/item";
import { Order } from "@domain/model/order";
import * as orderRepository from "@repositories/orderRepository";

const LOS_ANGELES_ID = 1;
const NEW_YORK_ID = 2;

const defaultItem: Item = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Standard Unit",
  price: toMoney(15000),
  currency: "USD",
  weightKg: 0.365,
};

function buildOrder(overrides: Partial<Order> = {}): Order {
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
    orderNumber: "ORD-0000001",
    status: "CONFIRMED",
    createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

describe("getOrder", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns exactly what the repository returns for an existing order number", async () => {
    const order = buildOrder();
    const stub = sinon.stub(orderRepository, "getOrderByNumber").resolves(order);

    const found = await getOrder(order.orderNumber);

    expect(found).to.deep.equal(order);
    expect(stub.calledWith(order.orderNumber)).to.equal(true);
  });

  it("returns undefined for an unknown order number", async () => {
    sinon.stub(orderRepository, "getOrderByNumber").resolves(undefined);

    expect(await getOrder("ORD-9999999")).to.equal(undefined);
  });

  it("passes through a multi-warehouse order's full allocation set untouched", async () => {
    const order = buildOrder({
      quantity: 30,
      allocations: [
        { warehouseId: LOS_ANGELES_ID, quantity: 20, distanceKm: 100, shippingCost: toMoney(730), currency: "USD" },
        { warehouseId: NEW_YORK_ID, quantity: 10, distanceKm: 50, shippingCost: toMoney(182), currency: "USD" },
      ],
    });
    sinon.stub(orderRepository, "getOrderByNumber").resolves(order);

    const found = await getOrder(order.orderNumber);

    expect(found?.allocations).to.have.lengthOf(2);
    expect(found?.allocations).to.deep.equal(order.allocations);
  });

  it("passes through an exact historical snapshot untouched, even values today's pricing rules would never produce", async () => {
    const order = buildOrder({
      quantity: 10,
      discountRate: 0.42,
      discount: toMoney(63000),
      subtotal: toMoney(150000),
      amountAfterDiscount: toMoney(87000),
      shippingCost: toMoney(999),
      total: toMoney(87999),
    });
    sinon.stub(orderRepository, "getOrderByNumber").resolves(order);

    const found = await getOrder(order.orderNumber);

    expect(found?.discountRate).to.equal(0.42);
    expect(found?.discount).to.equal(63000);
    expect(found?.amountAfterDiscount).to.equal(87000);
    expect(found?.shippingCost).to.equal(999);
    expect(found?.total).to.equal(87999);
  });
});
