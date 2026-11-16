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
  stockManaged: boolean;
  available: number | null;
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
  printer?: { id: string; name: string; stations: string[] } | null;
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
  printer_name: string | null;
  printer_stations: string[];
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

export interface OrderListRow {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  totalAmount: string;
  currency: string;
  clientCreatedAt: string;
  serverCreatedAt: string;
  closedAt: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  billGroupId?: string | null;
  waiter: { username: string; fullName: string };
}

export interface OrderListOptions {
  limit?: number;
  from?: string;
  to?: string;
}

export async function listMyOrders(options?: number | OrderListOptions) {
  const opts: OrderListOptions = typeof options === 'number'
    ? { limit: options }
    : options ?? {};
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 50));
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  return apiFetch<{ count: number; orders: OrderListRow[] }>(
    `/orders?${params.toString()}`,
  );
}

export async function cancelOrder(orderId: string, reason: string) {
  return apiFetch<FullOrder>(`/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
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
  from?: string;
  to?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.station) params.set('station', filters.station);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  params.set('limit', String(filters?.limit ?? 100));
  return apiFetch<{ count: number; printJobs: PrintJobFull[] }>(
    `/print-jobs?${params.toString()}`,
  );
}

/**
 * RFC 4122 v4 UUID.
 *
 * `crypto.randomUUID()` only exists in secure contexts, so it is undefined
 * when the app is opened over plain HTTP from another device on the LAN
 * (e.g. http://192.168.1.57:3000). getRandomValues works everywhere.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// -------- Cashier helpers --------
// Same endpoint as listMyOrders — the backend scopes by role.
// Cashier/Manager/Admin see all orders; Waiters see only their own.
export async function listOrdersForCashier(options?: number | OrderListOptions) {
  return listMyOrders(options);
}

// -------- Bill group helpers --------

export interface BillGroupOrder {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  totalAmount: string;
  closedAt: string | null;
  cancelledAt: string | null;
  waiter: { username: string; fullName: string };
  tableName: string | null;
}

export interface BillGroupDetail {
  billGroupId: string;
  orderCount: number;
  grandTotal: string;
  currency: string;
  orders: BillGroupOrder[];
}

export async function mergeOrders(orderIds: string[]) {
  return apiFetch<{ billGroupId: string; orderIds: string[]; orderCount: number }>(
    '/bill-groups/merge',
    { method: 'POST', body: JSON.stringify({ orderIds }) },
  );
}

export async function unmergeBillGroup(billGroupId: string) {
  return apiFetch<{ billGroupId: string; orderIds: string[]; orderCount: number }>(
    '/bill-groups/unmerge',
    { method: 'POST', body: JSON.stringify({ billGroupId }) },
  );
}

export async function printConsolidatedBill(billGroupId: string) {
  return apiFetch<{
    printJobId: string;
    billGroupId: string;
    orderCount: number;
    grandTotal: string;
    currency: string;
  }>(`/bill-groups/${billGroupId}/print`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getBillGroup(billGroupId: string) {
  return apiFetch<BillGroupDetail>(`/bill-groups/${billGroupId}`);
}

// -------- Report helpers --------

export async function getDailyReport(date: string) {
  return apiFetch<Record<string, unknown>>(`/reports/daily?date=${encodeURIComponent(date)}`);
}
