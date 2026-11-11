import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listKitchenOrders } from '../../lib/kitchen.api';
import type { KitchenOrder } from '../../lib/kitchen.api';
import './KitchenHome.css';
import '../../dashboard-upgrade.css';

const POLL_INTERVAL_MS = 10_000;

function ageSeconds(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function ageClass(secs: number): 'ok' | 'warn' | 'late' {
  if (secs < 120) return 'ok';
  if (secs < 300) return 'warn';
  return 'late';
}

function formatHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function KitchenHome() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, forceTick] = useState(0);
  const inFlightRef = useRef(false);

  async function fetchOrders() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await listKitchenOrders();
      if (!res.ok || !res.data) {
        setError(res.errorMessage ?? 'Failed to load kitchen orders');
        return;
      }
      setError(null);
      setOrders(res.data.orders);
      setLastUpdated(new Date());
    } catch {
      setError('Unable to connect to the server. Existing orders are kept on screen.');
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    void fetchOrders();
    const poll = window.setInterval(() => { void fetchOrders(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const lastUpdatedLabel = lastUpdated
    ? `Updated ${formatAge(ageSeconds(lastUpdated.toISOString()))} ago`
    : 'Waiting for first update';

  return (
    <main className="kitchen-page">
      <header className="kitchen-header">
        <div>
          <h1>Kitchen display</h1>
          <p className="kitchen-subtitle">{user?.fullName} · {lastUpdatedLabel} · Refreshes every 10 seconds</p>
        </div>
        <button className="kitchen-refresh" type="button" onClick={() => void fetchOrders()} disabled={inFlightRef.current}>
          Refresh now
        </button>
      </header>

      {error && <div className="kitchen-error" role="alert">{error}</div>}
      {!orders && !error && <p className="muted" role="status">Loading kitchen orders…</p>}
      {orders && orders.length === 0 && <section className="card"><h2>All caught up</h2><p className="muted">New kitchen orders will appear here.</p></section>}
      {orders && orders.length > 0 && (
        <section className="kitchen-grid" aria-label={`${orders.length} active kitchen orders`}>
          {orders.map((order) => {
            const secs = ageSeconds(order.serverCreatedAt);
            return (
              <article key={order.id} className="kitchen-card">
                <header className="kitchen-card-header">
                  <div>
                    <div className="kitchen-order-number">{order.orderNumber}</div>
                    <div className="kitchen-location">{order.tableName ?? 'Takeaway'}</div>
                    <div className="kitchen-waiter">{order.waiterFullName}</div>
                  </div>
                  <div className={`kitchen-age kitchen-age-${ageClass(secs)}`} aria-label={`Waiting ${formatAge(secs)}`}>
                    {formatAge(secs)}
                  </div>
                </header>
                <div className="kitchen-time-sent">
                  Sent {formatHHMM(order.serverCreatedAt)}
                  {order.status === 'PREPARING' && <span className="kitchen-badge-preparing"> · Preparing</span>}
                </div>
                <ul className="kitchen-items">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span className="kitchen-qty">{item.quantity}×</span>
                      <span>{item.productName}</span>
                      {item.notes && <span className="kitchen-note"> — {item.notes}</span>}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
