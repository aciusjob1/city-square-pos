import { apiFetch } from './api';

// -------- Shared types --------

export interface TableSummary {
  id: string;
  name: string;
  capacity: number;
  area: string | null;
  activeOrderId: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ProductRow {
  id: string;
  categoryId: string;
  name: string;
  sku: string | null;
  sellingPrice: string;
  preparationStation: 'KITCHEN' | 'BAR' | 'NONE';
}

export interface OrderItemRow {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  station: 'KITCHEN' | 'BAR' | 'NONE';
  notes: string | null;
}

export interface PrintJobRow {
  id: string;
  ticketType: 'KITCHEN' | 'BAR' | 'RECEIPT';
  status: string;
  attempts: number;
  printer?: { id: string; name: string; station: string };
}

export interface FullOrder {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  subtotal: string;
  totalAmount: string;
  currency: string;
  clientCreatedAt: string;
  serverCreatedAt: string;
  closedAt: string | null;
  waiter: { id: string; username: string; fullName: string };
  table: { id: string; name: string } | null;
  items: OrderItemRow[];
  printJobs: PrintJobRow[];
}

export interface PrintJobFull {
  id: string;
  ticket_type: 'KITCHEN' | 'BAR' | 'RECEIPT';
  status: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  printed_at: string | null;
  last_error: string | null;
  payload: string;
  idempotency_key: string | null;
  order_number: string;
  waiter_id: string;
  waiter_full_name: string;
  table_name: string | null;
  printer_name: string;
  printer_station: string;
}

// -------- Endpoints --------

export async function listTables() {
  return apiFetch<{ tables: TableSummary[] }>('/tables');
}

export async function getActiveOrderForTable(tableId: string) {
  return apiFetch<{ activeOrderId: string | null }>(`/tables/${tableId}/active-order`);
}

export async function listCategories() {
  return apiFetch<{ categories: CategoryRow[] }>('/categories');
}

export async function listProducts() {
  return apiFetch<{ products: ProductRow[] }>('/products');
}

export async function getOrder(orderId: string) {
  return apiFetch<FullOrder>(`/orders/${orderId}`);
}

export async function listMyOrders() {
  return apiFetch<{ count: number; orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    orderType: string;
    totalAmount: string;
    currency: string;
    clientCreatedAt: string;
    serverCreatedAt: string;
    waiter: { username: string; fullName: string };
  }> }>('/orders');
}

export async function createOrder(input: {
  clientUuid: string;
  tableId?: string;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  items: Array<{ productId: string; quantity: number; notes?: string }>;
}) {
  return apiFetch<FullOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function appendItems(orderId: string, input: {
  clientUuid: string;
  items: Array<{ productId: string; quantity: number; notes?: string }>;
}) {
  return apiFetch<FullOrder>(`/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function requestBill(orderId: string) {
  return apiFetch<{
    printJobId: string;
    orderId: string;
    orderNumber: string;
    bill: Record<string, unknown>;
    reprint: boolean;
  }>(`/orders/${orderId}/bill`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listPrintJobs(filters?: {
  status?: string;
  station?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.station) params.set('station', filters.station);
  params.set('limit', String(filters?.limit ?? 100));
  return apiFetch<{ count: number; printJobs: PrintJobFull[] }>(
    `/print-jobs?${params.toString()}`,
  );
}

export function uuid(): string {
  return crypto.randomUUID();
}
