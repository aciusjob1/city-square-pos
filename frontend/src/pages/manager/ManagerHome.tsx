import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { listOrdersForCashier, listPrintJobs, getDailyReport } from '../../lib/waiter.api';
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
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [pendingJobs, setPendingJobs] = useState<PrintJobFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    const [reportRes, ordersRes, jobsRes] = await Promise.all([
      getDailyReport(date),
      listOrdersForCashier(500),
      listPrintJobs({ status: 'PENDING', limit: 200 }),
    ]);
    setLoading(false);

    if (reportRes.ok && reportRes.data) setReport(reportRes.data as DailyReport);
    else setError(reportRes.errorMessage ?? 'Failed to load report');

    if (ordersRes.ok && ordersRes.data) setOrders(ordersRes.data.orders as OrderRow[]);
    if (jobsRes.ok && jobsRes.data) setPendingJobs(jobsRes.data.printJobs);
  };

  useEffect(() => { load(); }, [date]);

  const cancelledOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => o.cancelledAt || o.status === 'CANCELLED');
  }, [orders]);

  const openOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => !o.closedAt && !o.cancelledAt && o.status !== 'CANCELLED');
  }, [orders]);

  return (
    <div className="page manager-page">
      <header className="manager-header">
        <div>
          <h1>Manager Dashboard</h1>
          <p className="subtitle">{user?.fullName} · {new Date().toLocaleString()}</p>
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
              <table className="manager-table">
                <thead>
                  <tr><th>Waiter</th><th>Orders</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {report.byWaiter.map((w) => (
                    <tr key={w.username}>
                      <td>{w.full_name}</td>
                      <td>{w.order_count}</td>
                      <td>{report.currency} {parseInt(w.total, 10).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="manager-section">
            <h2>Top Products</h2>
            {report.topProducts.length === 0 ? (
              <p className="muted">No products sold.</p>
            ) : (
              <table className="manager-table">
                <thead>
                  <tr><th>Product</th><th>Qty</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {report.topProducts.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.qty_sold}</td>
                      <td>{report.currency} {parseInt(p.revenue, 10).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="manager-section">
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
        <Link to="/print-jobs" className="manager-quick-card">
          <div className="quick-label">Pending Print Jobs</div>
          <div className="quick-value">{pendingJobs?.length ?? '—'}</div>
        </Link>
        <div className="manager-quick-card">
          <div className="quick-label">Open Orders</div>
          <div className="quick-value">{openOrders.length}</div>
        </div>
        <div className="manager-quick-card quick-warn">
          <div className="quick-label">Cancelled Orders</div>
          <div className="quick-value">{cancelledOrders.length}</div>
        </div>
      </div>

      {cancelledOrders.length > 0 && (
        <section className="manager-section">
          <h2>Recent Cancelled Orders</h2>
          <table className="manager-table">
            <thead>
              <tr><th>Order</th><th>Waiter</th><th>Total</th></tr>
            </thead>
            <tbody>
              {cancelledOrders.slice(0, 10).map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNumber}</td>
                  <td>{o.waiter.fullName}</td>
                  <td>{o.currency} {parseInt(o.totalAmount, 10).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
