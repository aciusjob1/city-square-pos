import { apiFetch } from './api';

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
}

export async function listCategoriesFull() {
  return apiFetch<{ categories: CategoryRow[] }>('/categories');
}

export async function createCategory(input: { name: string; sortOrder?: number }) {
  return apiFetch<CategoryRow>('/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateCategory(
  id: string,
  input: { name?: string; sortOrder?: number },
) {
  return apiFetch<CategoryRow>(`/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deactivateCategory(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/categories/${id}`, {
    method: 'DELETE',
  });
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string;
  sellingPrice: string;
  costPrice: string;
  preparationStation: 'KITCHEN' | 'BAR' | 'NONE';
  isActive?: boolean;
  reorderLevel?: number;
  stockManaged?: boolean;
}

export async function listProductsFull() {
  return apiFetch<{ products: ProductRow[] }>('/products');
}

export async function createProduct(input: {
  name: string;
  sku?: string;
  categoryId: string;
  sellingPrice: number;
  costPrice?: number;
  preparationStation: 'KITCHEN' | 'BAR' | 'NONE';
}) {
  return apiFetch<ProductRow>('/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateProduct(id: string, input: {
  name?: string;
  sku?: string;
  categoryId?: string;
  sellingPrice?: number;
  costPrice?: number;
  preparationStation?: 'KITCHEN' | 'BAR' | 'NONE';
  reorderLevel?: number;
  stockManaged?: boolean;
}) {
  return apiFetch<ProductRow>(`/products/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deactivateProduct(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/products/${id}`, {
    method: 'DELETE',
  });
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';
  isActive: boolean;
  lastLoginAt: string | null;
}

export async function listUsersFull() {
  return apiFetch<{ users: UserRow[] }>('/users');
}

export async function listRolesFull() {
  return apiFetch<{ roles: string[] }>('/roles');
}

export async function createUser(input: {
  username: string;
  fullName: string;
  email?: string;
  role: string;
  password: string;
  pin?: string;
}) {
  return apiFetch<UserRow>('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateUser(id: string, input: {
  fullName?: string;
  email?: string;
  role?: string;
}) {
  return apiFetch<UserRow>(`/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function resetUserPassword(id: string, newPassword: string) {
  return apiFetch<{ ok: true }>(`/users/${id}/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
}

export async function setUserPin(id: string, pin: string) {
  return apiFetch<{ ok: true }>(`/users/${id}/pin`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

export async function deactivateUser(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/users/${id}`, {
    method: 'DELETE',
  });
}

export interface SettingsShape {
  restaurantName: string;
  currency: string;
  timezone: string;
  printerDefaults: {
    kitchen: string | null;
    bar: string | null;
    receipt: string | null;
  };
}

export interface PrinterRow {
  id: string;
  name: string;
  ipAddress: string;
  port: number;
  station: 'KITCHEN' | 'BAR' | 'NONE';
  isActive: boolean;
  type: 'NETWORK' | 'OS';
}

export async function getSettings() {
  return apiFetch<{ settings: SettingsShape }>('/settings');
}

export async function patchSettings(updates: Record<string, any>) {
  return apiFetch<{ ok: true }>('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function listPrintersFull() {
  return apiFetch<{ printers: PrinterRow[] }>('/printers');
}

export async function updatePrinter(id: string, input: {
  name?: string;
  ipAddress?: string;
  port?: number;
  station?: 'KITCHEN' | 'BAR' | 'NONE';
  isActive?: boolean;
}) {
  return apiFetch<PrinterRow>(`/printers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deactivatePrinter(id: string) {
  return apiFetch<{ id: string; isActive: false }>(`/printers/${id}`, {
    method: 'DELETE',
  });
}

export type StockStatus = 'OK' | 'LOW' | 'OUT';

export interface StockBalanceRow {
  productId: string;
  productName: string;
  balance: number;
  reorderLevel: number;
  status: StockStatus;
}

export async function listStockBalances() {
  return apiFetch<{ balances: StockBalanceRow[] }>('/stock/balances');
}

export async function listLowStock() {
  return apiFetch<{ products: Array<{ productId: string; productName: string; balance: number; reorderLevel: number }> }>('/stock/low-stock');
}

export async function restockProduct(productId: string, quantity: number, notes?: string) {
  return apiFetch<{ ok: true }>('/stock/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity, notes }),
  });
}

