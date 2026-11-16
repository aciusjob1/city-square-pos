import { apiFetch } from './api';

export type DayRolloverMode = 'AUTO' | 'MANUAL';

export interface DaySummary {
  totalSales: string;
  orderCount: number;
  cancelledCount: number;
  cancelledTotal: string;
}

export interface OpenDay {
  id: string;
  businessDate: string;
  openedAt: string;
  openedByName: string | null;
  summary: DaySummary;
}

export interface ClosedDay {
  id: string;
  businessDate: string;
  openedAt: string;
  closedAt: string;
  totalSales: string;
  orderCount: number;
  cancelledCount: number;
  cancelledTotal: string;
  closedByName: string | null;
}

export interface DayStatus {
  mode: DayRolloverMode;
  today: string;
  openDay: OpenDay | null;
  lastClosedDay: ClosedDay | null;
  recentDays: ClosedDay[];
}

export async function getDayStatus() {
  return apiFetch<DayStatus>('/day/status');
}

export async function closeDay(force = false) {
  return apiFetch<DayStatus & { ok: true }>('/day/close', {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}

export async function openDay() {
  return apiFetch<DayStatus & { ok: true }>('/day/open', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function rolloverDay(force = false) {
  return apiFetch<DayStatus & { ok: true }>('/day/rollover', {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}
