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

