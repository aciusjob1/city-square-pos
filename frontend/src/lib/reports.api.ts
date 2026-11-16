import { apiFetch } from './api';

export type TrendGranularity = 'day' | 'week' | 'month' | 'year';

export interface SalesSummary {
  range: { from: string; to: string; days: number };
  currency: string;
  search: string | null;
  filters: {
    waiter: { id: string; username: string; fullName: string } | null;
    product: { id: string; name: string; category: string | null } | null;
  };
  summary: {
    totalSales: string;
    orderCount: number;
    avgOrderValue: string;
    itemCount: number;
    cancelledCount: number;
    cancelledTotal: string;
  };
  byProduct: Array<{
    id: string;
    name: string;
    category: string | null;
    qty_sold: string;
    revenue: string;
    order_count: string;
  }>;
  byWaiter: Array<{
    id: string;
    username: string;
    full_name: string;
    order_count: string;
    total: string;
    item_count: string;
  }>;
  trend: {
    granularity: TrendGranularity;
    rows: Array<{ period: string; order_count: string; total: string }>;
  };
}

export interface SalesSummaryFilters {
  waiterId?: string | null;
  productId?: string | null;
  granularity?: TrendGranularity;
}

export async function getSalesSummary(
  from: string,
  to: string,
  filters: SalesSummaryFilters = {},
) {
  const params = new URLSearchParams({ from, to });
  if (filters.waiterId) params.set('waiterId', String(filters.waiterId));
  if (filters.productId) params.set('productId', String(filters.productId));
  if (filters.granularity) params.set('granularity', filters.granularity);
  return apiFetch<SalesSummary>(`/reports/summary?${params.toString()}`);
}

export async function getMySales(
  from: string,
  to: string,
  granularity: TrendGranularity,
) {
  const params = new URLSearchParams({ from, to, granularity });
  return apiFetch<SalesSummary>(`/reports/my-sales?${params.toString()}`);
}
