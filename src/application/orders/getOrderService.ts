import { Order } from "@domain/model/order";
import orderRepository from "@repositories/orderRepository";

export async function getOrder(orderNumber: string): Promise<Order | undefined> {
  return orderRepository.getOrderByNumber(orderNumber);
}

export default { getOrder };
