import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listKitchenOrders } from '../../lib/kitchen.api';
import type { KitchenOrder } from '../../lib/kitchen.api';
import './KitchenHome.css';

const POLL_INTERVAL_MS = 10_000;

function ageSeconds(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
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

  // Prevent overlapping polls: only one in-flight request at a time.
  const inFlightRef = useRef(false);

  async function fetchOrders() {
    if (inFlightRef.current) return;      // skip if a request is already running
    inFlightRef.current = true;
    try {
      const res = await listKitchenOrders();
      if (!res.ok || !res.data) {
        // Preserve existing orders. Show error. Do NOT bump lastUpdated.
        setError(res.errorMessage ?? 'Failed to load kitchen orders');
        return;
      }
      setError(null);
      setOrders(res.data.orders);
      setLastUpdated(new Date());
    } finally {
      inFlightRef.current = false;
    }
  }

  // Initial fetch + 10s poll
  useEffect(() => {
    fetchOrders();
    const poll = setInterval(fetchOrders, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Local 1s tick so waiting-time stays live between polls
  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const lastUpdatedLabel = lastUpdated
    ? `Updated ${formatAge(ageSeconds(lastUpdated.toISOString()))} ago`
    : 'Not yet updated';

  return (
    <div className="kitchen-page">
      <div className="kitchen-header">
        <div>
          <h1>Kitchen</h1>
          <p className="kitchen-subtitle">
            {user?.fullName} · {lastUpdatedLabel}
          </p>
        </div>
        <button className="kitchen-refresh" onClick={fetchOrders}>
          Refresh
        </button>
      </div>

      {error && <div className="kitchen-error">{error}</div>}

      {!orders && !error && <p className="muted">Loading…</p>}
      {orders && orders.length === 0 && (
        <p className="muted">No pending orders.</p>
      )}

      {orders && orders.length > 0 && (
        <div className="kitchen-grid">
          {orders.map((o) => {
            const secs = ageSeconds(o.serverCreatedAt);
            return (
              <div key={o.id} className="kitchen-card">
                <div className="kitchen-card-header">
                  <div>
                    <div className="kitchen-order-number">{o.orderNumber}</div>
                    <div className="kitchen-location">
                      {o.tableName ?? 'Takeaway'}
                    </div>
                    <div className="kitchen-waiter">
                      {o.waiterFullName}
                    </div>
                  </div>
                  <div className={`kitchen-age kitchen-age-${ageClass(secs)}`}>
                    {formatAge(secs)}
                  </div>
                </div>

                <div className="kitchen-time-sent">
                  Sent {formatHHMM(o.serverCreatedAt)}
                  {o.status === 'PREPARING' && (
                    <span className="kitchen-badge-preparing"> · Preparing</span>
                  )}
                </div>

                <ul className="kitchen-items">
                  {o.items.map((it) => (
                    <li key={it.id}>
                      <span className="kitchen-qty">{it.quantity}×</span>
                      <span>{it.productName}</span>
                      {it.notes && (
                        <span className="kitchen-note"> — {it.notes}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
