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
