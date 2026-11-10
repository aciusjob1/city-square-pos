import { apiFetch } from './api';

export interface KitchenOrderItem {
  id: string;
  productName: string;
  quantity: number;
  notes: string | null;
}

export interface KitchenOrder {
  id: string;
  orderNumber: string;
  status: 'SENT_TO_KITCHEN' | 'PREPARING';
  orderType: string;
  tableName: string | null;
  waiterFullName: string;
  serverCreatedAt: string;
  items: KitchenOrderItem[];
}

export interface KitchenListResponse {
  count: number;
  orders: KitchenOrder[];
}

export async function listKitchenOrders() {
  return apiFetch<KitchenListResponse>('/orders/kitchen');
}
