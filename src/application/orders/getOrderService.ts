import { Order } from "../../domain/model/order";
import * as orderRepository from "../../repositories/orderRepository";

export async function getOrder(orderNumber: string): Promise<Order | undefined> {
  return orderRepository.getOrderByNumber(orderNumber);
}
