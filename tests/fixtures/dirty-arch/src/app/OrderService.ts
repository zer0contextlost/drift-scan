// CIRCULAR: app → adapter → app
import { PaymentAdapter } from '../adapters/PaymentAdapter';

export class OrderService {
  async processOrder(orderId: string): Promise<void> {
    await PaymentAdapter.charge(orderId);
  }
}
