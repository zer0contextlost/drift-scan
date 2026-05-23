// CIRCULAR: adapter → app (back-reference creating cycle)
import { OrderService } from '../app/OrderService';

export const PaymentAdapter = {
  async charge(orderId: string): Promise<void> {
    const svc = new OrderService();
    await svc.processOrder(orderId);
  }
};
