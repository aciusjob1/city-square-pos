import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listOrdersForCashier } from '../../lib/waiter.api';
import { getSalesSummary } from '../../lib/reports.api';
import type { SalesSummary } from '../../lib/reports.api';
import { getDayStatus, closeDay, openDay, rolloverDay } from '../../lib/day.api';
import type { DayStatus } from '../../lib/day.api';
import './CashierHome.css';

const TZ = 'Africa/Dar_es_Salaam';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  totalAmount: string;
  currency: string;
  serverCreatedAt: string;
  closedAt: string | null;
  waiter: { username: string; fullName: string };
}

function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isToday(iso: string): boolean {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso)) === businessToday();
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function CashierHome() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [todaySales, setTodaySales] = useState<SalesSummary | null>(null);
  const [day, setDay] = useState<DayStatus | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    const today = businessToday();
    const [ordersRes, salesRes, dayRes] = await Promise.all([
      listOrdersForCashier({ limit: 100 }),
      getSalesSummary(today, today),
      getDayStatus(),
    ]);

    if (ordersRes.ok && ordersRes.data) {
      setOrders(
        (ordersRes.data.orders as OrderRow[]).filter((o) => o.status !== 'CANCELLED'),
      );
    } else {
      setError(ordersRes.errorMessage ?? 'Failed to load orders');
    }
    if (salesRes.ok && salesRes.data) setTodaySales(salesRes.data);
    if (dayRes.ok && dayRes.data) setDay(dayRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onDayAction = async (action: 'close' | 'open' | 'rollover') => {
    if (
      action !== 'open' &&
      !window.confirm(
        action === 'close'
          ? 'Close the business day?'
          : 'Close the current day and open a new one?',
      )
    ) {
      return;
    }
    setDayBusy(true);
    const call = (force: boolean) => action === 'close'
      ? closeDay(force)
      : action === 'open'
        ? openDay()
        : rolloverDay(force);
    let r = await call(false);
    if (!r.ok && r.status === 409) {
      if (window.confirm(`${r.errorMessage}\n\nProceed anyway?`)) {
        r = await call(true);
      }
    }
    setDayBusy(false);
    if (r.ok && r.data) setDay(r.data);
    else if (!r.ok) setError(r.errorMessage ?? 'Day action failed');
  };

  const currency = orders?.[0]?.currency ?? todaySales?.currency ?? 'TZS';

  const openOrders = useMemo(
    () => (orders ?? []).filter((o) => !o.closedAt),
    [orders],
  );
  const closedToday = useMemo(
    () => (orders ?? []).filter((o) => o.closedAt && isToday(o.closedAt)),
    [orders],
  );

  const openTotal = openOrders.reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const closedTotal = closedToday.reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const recentOpen = [...openOrders]
    .sort((a, b) => new Date(b.serverCreatedAt).getTime() - new Date(a.serverCreatedAt).getTime())
    .slice(0, 5);

  const money = (value: string | number) =>
    `${currency} ${Math.round(Number(value)).toLocaleString()}`;

  return (
    <div className="page cashier-home">
      <header className="cashier-home-header">
        <div>
          <h1>Cashier Home</h1>
          <p className="subtitle">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            {' · '}
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button className="cashier-home-refresh" onClick={load} disabled={loading}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      {day && (
        <section className="cashier-day">
          <div className="cashier-day-info">
            <span className={`cashier-day-dot${day.openDay ? ' open' : ' closed'}`} aria-hidden="true" />
            <span className="cashier-day-title">
              {day.openDay
                ? `Business day open · ${day.openDay.businessDate}`
                : 'Business day closed'}
            </span>
            <span className="cashier-day-mode">
              {day.mode === 'AUTO' ? 'Automatic rollover' : 'Manual rollover'}
            </span>
            {day.openDay && (
              <span className="cashier-day-sub">
                {money(day.openDay.summary.totalSales)} · {day.openDay.summary.orderCount} orders
              </span>
            )}
          </div>
          <div className="cashier-day-actions">
            {day.openDay ? (
              <>
                <button onClick={() => onDayAction('close')} disabled={dayBusy}>Close day</button>
                <button onClick={() => onDayAction('rollover')} disabled={dayBusy}>Roll over</button>
              </>
            ) : (
              <button onClick={() => onDayAction('open')} disabled={dayBusy}>Open day</button>
            )}
          </div>
        </section>
      )}

      <div className="cashier-kpis">
        <Link to="/cashier/orders" className="cashier-kpi">
          <span className="cashier-kpi-label">Open bills</span>
          <span className="cashier-kpi-value">{openOrders.length}</span>
          <span className="cashier-kpi-sub">{money(openTotal)} outstanding</span>
        </Link>
        <Link to="/cashier/orders" className="cashier-kpi">
          <span className="cashier-kpi-label">Closed today</span>
          <span className="cashier-kpi-value">{closedToday.length}</span>
          <span className="cashier-kpi-sub">{money(closedTotal)} billed</span>
        </Link>
        <Link to="/reports" className="cashier-kpi">
          <span className="cashier-kpi-label">Today's sales</span>
          <span className="cashier-kpi-value">
            {todaySales ? money(todaySales.summary.totalSales) : '—'}
          </span>
          <span className="cashier-kpi-sub">
            {todaySales ? `${todaySales.summary.itemCount} items sold` : 'Reports unavailable'}
          </span>
        </Link>
        <Link to="/reports" className="cashier-kpi">
          <span className="cashier-kpi-label">Today's orders</span>
          <span className="cashier-kpi-value">
            {todaySales ? todaySales.summary.orderCount : '—'}
          </span>
          <span className="cashier-kpi-sub">
            {todaySales ? `Avg ${money(todaySales.summary.avgOrderValue)}` : ' '}
          </span>
        </Link>
      </div>

      <section className="cashier-quick">
        <h2>Quick actions</h2>
        <div className="cashier-quick-grid">
          <Link to="/cashier/orders" className="cashier-quick-card">
            <span className="cashier-quick-title">Orders &amp; Bills</span>
            <span className="cashier-quick-desc">
              Merge orders, print bills and close tables.
            </span>
          </Link>
          <Link to="/reports" className="cashier-quick-card">
            <span className="cashier-quick-title">Sales Reports</span>
            <span className="cashier-quick-desc">
              Product and waiter totals for any period.
            </span>
          </Link>
          <Link to="/print-jobs" className="cashier-quick-card">
            <span className="cashier-quick-title">Print Jobs</span>
            <span className="cashier-quick-desc">
              Check kitchen, bar and receipt tickets.
            </span>
          </Link>
          <Link to="/cashier/sold-out" className="cashier-quick-card">
            <span className="cashier-quick-title">Sold Out</span>
            <span className="cashier-quick-desc">
              Mark items unavailable when the kitchen runs out.
            </span>
          </Link>
        </div>
      </section>

      <section className="cashier-open-section">
        <div className="cashier-open-head">
          <h2>Open bills</h2>
          <Link to="/cashier/orders" className="cashier-open-all">
            View all {openOrders.length > 0 ? `(${openOrders.length})` : ''}
          </Link>
        </div>

        {!orders && !error && <p className="muted">Loading…</p>}
        {orders && recentOpen.length === 0 && (
          <p className="muted">No open bills right now.</p>
        )}
        {recentOpen.length > 0 && (
          <div className="cashier-open-list">
            {recentOpen.map((o) => (
              <Link to="/cashier/orders" className="cashier-open-row" key={o.id}>
                <div className="cashier-open-main">
                  <span className="cashier-open-number">{o.orderNumber}</span>
                  <span className="cashier-open-waiter">{o.waiter.fullName}</span>
                </div>
                <div className="cashier-open-meta">
                  <span className="cashier-open-amount">{money(o.totalAmount)}</span>
                  <span className="cashier-open-time">{timeAgo(o.serverCreatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {openOrders.length > recentOpen.length && (
          <p className="muted">
            Showing the latest {recentOpen.length} of {openOrders.length} open bills.
          </p>
        )}
      </section>
    </div>
  );
}
