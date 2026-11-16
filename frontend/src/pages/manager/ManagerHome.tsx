import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listOrdersForCashier, listPrintJobs, getDailyReport } from '../../lib/waiter.api';
import {
  getDayStatus, closeDay, openDay, rolloverDay,
} from '../../lib/day.api';
import type { DayStatus } from '../../lib/day.api';
import type { PrintJobFull } from '../../lib/waiter.api';
import './ManagerHome.css';

interface DailyReport {
  date: string;
  currency: string;
  summary: {
    totalSales: string;
    orderCount: number;
    avgOrderValue: string;
    cancelledCount: number;
    cancelledTotal: string;
  };
  byWaiter: Array<{ username: string; full_name: string; order_count: string; total: string }>;
  byHour: Array<{ hour: string; order_count: string; total: string }>;
  topProducts: Array<{ name: string; qty_sold: string; revenue: string }>;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  totalAmount: string;
  currency: string;
  status: string;
  closedAt: string | null;
  cancelledAt?: string | null;
  serverCreatedAt: string;
  waiter: { username: string; fullName: string };
}

function todayISO(): string {
  // Use Africa/Dar_es_Salaam to match the backend's report date logic.
  // toISOString() would return the UTC date, which is wrong for the first
  // three hours of every day (UTC+3 vs UTC).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function ManagerHome() {
  const [date, setDate] = useState(todayISO());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [cancelledOrders, setCancelledOrders] = useState<OrderRow[]>([]);
  const [pendingJobs, setPendingJobs] = useState<PrintJobFull[] | null>(null);
  const [day, setDay] = useState<DayStatus | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    const [reportRes, ordersRes, cancelledRes, jobsRes, dayRes] = await Promise.all([
      getDailyReport(date),
      listOrdersForCashier({ limit: 200 }),
      listOrdersForCashier({ limit: 200, from: date, to: date }),
      listPrintJobs({ status: 'PENDING', limit: 100 }),
      getDayStatus(),
    ]);
    setLoading(false);

    if (reportRes.ok && reportRes.data) setReport(reportRes.data as unknown as DailyReport);
    else setError(reportRes.errorMessage ?? 'Failed to load report');

    if (ordersRes.ok && ordersRes.data) setOrders(ordersRes.data.orders as OrderRow[]);
    if (cancelledRes.ok && cancelledRes.data) {
      setCancelledOrders(
        (cancelledRes.data.orders as OrderRow[]).filter(
          (o) => o.cancelledAt || o.status === 'CANCELLED',
        ),
      );
    }
    if (jobsRes.ok && jobsRes.data) setPendingJobs(jobsRes.data.printJobs);
    if (dayRes.ok && dayRes.data) setDay(dayRes.data);
    else if (!dayRes.ok) setError(dayRes.errorMessage ?? 'Failed to load business day');
  };

  useEffect(() => { load(); }, [date]);

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

  const openOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => !o.closedAt && !o.cancelledAt && o.status !== 'CANCELLED');
  }, [orders]);

  return (
    <div className="page manager-page manager-dashboard">
      <header className="manager-page-header">
        <div>
          <h1>Manager Dashboard</h1>
          <p className="subtitle">{new Date().toLocaleString()}</p>
        </div>
        <button className="manager-refresh" onClick={load} disabled={loading}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="manager-date-picker">
        <label>
          Report date:
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayISO()}
          />
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {day && (
        <section className="manager-section manager-day">
          <div className="manager-day-head">
            <h2>Current business day</h2>
            <span className={`manager-day-mode${day.mode === 'AUTO' ? ' auto' : ''}`}>
              {day.mode === 'AUTO' ? 'Automatic rollover' : 'Manual rollover'}
            </span>
          </div>
          {day.openDay ? (
            <>
              <div className="manager-day-row">
                <span className="manager-day-status open">● Open</span>
                <strong>{day.openDay.businessDate}</strong>
                <span className="muted">
                  since {new Date(day.openDay.openedAt).toLocaleString()}
                  {day.openDay.openedByName ? ` · ${day.openDay.openedByName}` : ''}
                </span>
              </div>
              <p className="manager-day-hint">
                Live session totals since the day was opened — these do not follow
                the report date above.
              </p>
              <div className="manager-day-kpis">
                <div className="manager-day-kpi sales">
                  <span className="manager-day-kpi-label">Sales</span>
                  <strong className="manager-day-kpi-value">
                    {report?.currency ?? 'TZS'}{' '}
                    {parseInt(day.openDay.summary.totalSales, 10).toLocaleString()}
                  </strong>
                  <span className="manager-day-kpi-meta">since day opened</span>
                </div>
                <div className="manager-day-kpi orders">
                  <span className="manager-day-kpi-label">Orders</span>
                  <strong className="manager-day-kpi-value">
                    {day.openDay.summary.orderCount}
                  </strong>
                  <span className="manager-day-kpi-meta">placed this session</span>
                </div>
                <div
                  className={`manager-day-kpi cancelled${
                    day.openDay.summary.cancelledCount > 0 ? ' has-value' : ''
                  }`}
                >
                  <span className="manager-day-kpi-label">Cancelled</span>
                  <strong className="manager-day-kpi-value">
                    {day.openDay.summary.cancelledCount}
                  </strong>
                  <span className="manager-day-kpi-meta">
                    {day.openDay.summary.cancelledCount > 0
                      ? 'not counted in sales'
                      : 'none so far'}
                  </span>
                </div>
              </div>
              <div className="manager-day-actions">
                <button className="primary" onClick={() => onDayAction('close')} disabled={dayBusy}>
                  Close day
                </button>
                <button onClick={() => onDayAction('rollover')} disabled={dayBusy}>
                  Roll over
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="manager-day-row">
                <span className="manager-day-status closed">● Closed</span>
                <span>No business day is open.</span>
              </div>
              <div className="manager-day-actions">
                <button className="primary" onClick={() => onDayAction('open')} disabled={dayBusy}>
                  Open day
                </button>
              </div>
            </>
          )}

          {day.recentDays.length > 0 && (
            <div className="manager-table-scroll">
              <table className="manager-table manager-day-history">
                <thead>
                  <tr><th>Day</th><th>Closed</th><th>By</th><th>Orders</th><th>Sales</th></tr>
                </thead>
                <tbody>
                  {day.recentDays.slice(0, 5).map((d) => (
                    <tr key={d.id}>
                      <td>{d.businessDate}</td>
                      <td>{new Date(d.closedAt).toLocaleString()}</td>
                      <td>{d.closedByName ?? 'Automatic'}</td>
                      <td>{d.orderCount}</td>
                      <td>{report?.currency ?? 'TZS'} {parseInt(d.totalSales, 10).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {report && (
        <>
          <div className="manager-kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Total Sales</div>
              <div className="kpi-value">{report.currency} {parseInt(report.summary.totalSales, 10).toLocaleString()}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Orders</div>
              <div className="kpi-value">{report.summary.orderCount}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Avg Order</div>
              <div className="kpi-value">{report.currency} {parseInt(report.summary.avgOrderValue, 10).toLocaleString()}</div>
            </div>
            <div className="kpi-card kpi-warn">
              <div className="kpi-label">Cancelled</div>
              <div className="kpi-value">{report.summary.cancelledCount} · {report.currency} {parseInt(report.summary.cancelledTotal, 10).toLocaleString()}</div>
            </div>
          </div>

          <section className="manager-section">
            <h2>By Waiter</h2>
            {report.byWaiter.length === 0 ? (
              <p className="muted">No sales recorded.</p>
            ) : (
              <div className="manager-table-scroll">
                <table className="manager-table">
                  <thead>
                    <tr><th>Waiter</th><th>Orders</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {report.byWaiter.slice(0, 8).map((w) => (
                      <tr key={w.username}>
                        <td>{w.full_name}</td>
                        <td>{w.order_count}</td>
                        <td>{report.currency} {parseInt(w.total, 10).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.byWaiter.length > 8 && (
              <p className="muted">Showing the top 8 of {report.byWaiter.length} waiters — see Reports for the full list.</p>
            )}
          </section>

          <section className="manager-section">
            <h2>Top Products</h2>
            {report.topProducts.length === 0 ? (
              <p className="muted">No products sold.</p>
            ) : (
              <div className="manager-table-scroll">
                <table className="manager-table">
                  <thead>
                    <tr><th>Product</th><th>Qty</th><th>Revenue</th></tr>
                  </thead>
                  <tbody>
                    {report.topProducts.slice(0, 10).map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>{p.qty_sold}</td>
                        <td>{report.currency} {parseInt(p.revenue, 10).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted">Top 10 products only — see Reports for the full breakdown.</p>
          </section>
        </>
      )}

      <section className="manager-section manager-hourly-section">
        <h2>Sales by Hour</h2>
        {report && report.byHour.length === 0 ? (
          <p className="muted">No sales recorded.</p>
        ) : report && report.byHour.length > 0 ? (() => {
          const maxTotal = Math.max(...report.byHour.map((h) => parseFloat(h.total)));
          return (
            <div className="manager-hourly">
              {report.byHour.map((h) => {
                const pct = maxTotal > 0 ? (parseFloat(h.total) / maxTotal) * 100 : 0;
                return (
                  <div className="manager-hourly-row" key={h.hour}>
                    <span className="hour-label">{h.hour}</span>
                    <div className="hour-bar-wrap">
                      <div
                        className="hour-bar"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="hour-count">{h.order_count} ord</span>
                    <span className="hour-total">
                      {report.currency} {parseInt(h.total, 10).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })() : null}
      </section>


      <div className="manager-quick-links">
        <Link to="/manager/reports" className="manager-quick-card">
          <div className="quick-label">Sales Reports</div>
          <div className="quick-value quick-value-sm">Product &amp; waiter</div>
        </Link>
        <Link to="/manager/print-jobs" className="manager-quick-card">
          <div className="quick-label">Pending Print Jobs</div>
          <div className="quick-value">{pendingJobs?.length ?? '—'}</div>
        </Link>
        <Link to="/manager/orders" className="manager-quick-card">
          <div className="quick-label">Open Orders</div>
          <div className="quick-value">{openOrders.length}</div>
        </Link>
      </div>

      {cancelledOrders.length > 0 && (
        <section className="manager-section">
          <h2>Cancelled Orders <span className="muted">· {date}</span></h2>
          <div className="manager-table-scroll">
            <table className="manager-table">
              <thead>
                <tr><th>Order</th><th>Waiter</th><th>Total</th></tr>
              </thead>
              <tbody>
                {cancelledOrders.slice(0, 5).map((o) => (
                  <tr key={o.id}>
                    <td>{o.orderNumber}</td>
                    <td>{o.waiter.fullName}</td>
                    <td>{o.currency} {parseInt(o.totalAmount, 10).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Showing the latest 5 of {cancelledOrders.length} cancelled orders on {date}.
          </p>
        </section>
      )}
    </div>
  );
}
