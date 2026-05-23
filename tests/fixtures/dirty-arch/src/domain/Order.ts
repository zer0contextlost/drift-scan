// VIOLATION: domain imports infrastructure directly
import { db } from '../infra/Database';

export interface Order {
  id: string;
  total: number;
}

export async function saveOrder(order: Order): Promise<void> {
  await db.query('INSERT INTO orders ...', [order.id, order.total]);
}
