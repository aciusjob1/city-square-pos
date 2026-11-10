import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listOrdersForCashier,
  requestBill,
  getOrder,
} from '../../lib/waiter.api';
import type { FullOrder } from '../../lib/waiter.api';
import './CashierHome.css';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  totalAmount: string;
  currency: string;
  clientCreatedAt: string;
  serverCreatedAt: string;
  closedAt: string | null;
  waiter: { username: string; fullName: string };
}

type Filter = 'open' | 'closed' | 'all';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function CashierHome() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, FullOrder>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});
  const [billBusy, setBillBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const r = await listOrdersForCashier();
    if (r.ok && r.data) setOrders(r.data.orders);
    else setError(r.errorMessage ?? 'Failed to load orders');
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    if (!orders) return { open: 0, closed: 0, all: 0 };
    const open = orders.filter((o) => !o.closedAt).length;
    const closed = orders.filter((o) => o.closedAt && isToday(o.closedAt)).length;
    return { open, closed, all: orders.length };
  }, [orders]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    let list = orders;
    if (filter === 'open') list = list.filter((o) => !o.closedAt);
    else if (filter === 'closed') list = list.filter((o) => o.closedAt && isToday(o.closedAt));

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.waiter.fullName.toLowerCase().includes(q) ||
        o.waiter.username.toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, filter, query]);

  const onToggleDetails = async (orderId: string) => {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(orderId);
    if (!details[orderId]) {
      setDetailsLoading((s) => ({ ...s, [orderId]: true }));
      const r = await getOrder(orderId);
      setDetailsLoading((s) => ({ ...s, [orderId]: false }));
      if (r.ok && r.data) {
        setDetails((d) => ({ ...d, [orderId]: r.data! }));
      } else {
        setToast(r.errorMessage ?? 'Failed to load details');
      }
    }
  };

  const onPrintBill = async (orderId: string) => {
    setBillBusy((b) => ({ ...b, [orderId]: true }));
    const res = await requestBill(orderId);
    setBillBusy((b) => ({ ...b, [orderId]: false }));
    if (res.ok && res.data) {
      setToast(res.data.reprint ? 'Bill re-printed' : 'Bill sent to printer');
      await load();
    } else {
      setToast(res.errorMessage ?? 'Bill failed');
    }
  };

  return (
    <div className="cashier-page">
      <header className="cashier-header">
        <div>
          <h1>Cashier</h1>
          <p className="cashier-subtitle">
            {user?.fullName} · Today, {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button className="cashier-refresh" onClick={load}>↻ Refresh</button>
      </header>

      <div className="cashier-search">
        <input
          type="text"
          placeholder="Search order number, waiter or table…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="cashier-tabs">
        <button
          className={filter === 'open' ? 'active' : ''}
          onClick={() => setFilter('open')}
        >
          Open <span className="count">{counts.open}</span>
        </button>
        <button
          className={filter === 'closed' ? 'active' : ''}
          onClick={() => setFilter('closed')}
        >
          Closed today <span className="count">{counts.closed}</span>
        </button>
        <button
          className={filter === 'all' ? 'active' : ''}
          onClick={() => setFilter('all')}
        >
          All <span className="count">{counts.all}</span>
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {!orders && !error && <p className="muted" style={{ marginTop: 24 }}>Loading…</p>}
      {orders && filtered.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>No orders in this view.</p>
      )}

      {orders && filtered.length > 0 && (
        <div className="cashier-list">
          {filtered.map((o) => {
            const isOpen = !o.closedAt;
            const isExpanded = expandedId === o.id;
            const detail = details[o.id];
            const isLoading = detailsLoading[o.id];

            return (
              <div className={`cashier-row${isExpanded ? ' expanded' : ''}`} key={o.id}>
                <button className="cashier-row-header" onClick={() => onToggleDetails(o.id)}>
                  <div className="row-main">
                    <span className="order-num">{o.orderNumber}</span>
                    <span className="order-total">{o.currency} {parseInt(o.totalAmount, 10).toLocaleString()}</span>
                  </div>
                  <div className="row-meta">
                    <span className={`order-badge ${isOpen ? 'badge-open' : 'badge-closed'}`}>
                      {isOpen ? 'Open' : 'Closed'}
                    </span>
                    <span>{o.waiter.fullName}</span>
                    <span>{o.orderType === 'TAKEAWAY' ? 'Takeaway' : ''}</span>
                    <span className="time-ago">{timeAgo(o.serverCreatedAt)}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="cashier-details">
                    {isLoading && <p className="muted">Loading details…</p>}
                    {detail && (
                      <>
                        <div className="detail-row">
                          <span>Table</span>
                          <span>{detail.table?.name ?? 'Takeaway'}</span>
                        </div>
                        <div className="detail-row">
                          <span>Waiter</span>
                          <span>{detail.waiter.fullName}</span>
                        </div>
                        <div className="detail-sep" />
                        {detail.items.map((it) => (
                          <div className="detail-row" key={it.id}>
                            <span>{it.quantity}× {it.productName}</span>
                            <span>{detail.currency} {parseInt(it.lineTotal, 10).toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="detail-sep" />
                        <div className="detail-row detail-total">
                          <span>TOTAL</span>
                          <span>{detail.currency} {parseInt(detail.totalAmount, 10).toLocaleString()}</span>
                        </div>
                        {isOpen && (
                          <button
                            className="cashier-print-btn"
                            onClick={() => onPrintBill(o.id)}
                            disabled={!!billBusy[o.id]}
                          >
                            {billBusy[o.id] ? 'Printing…' : 'Print Bill'}
                          </button>
                        )}
                        {!isOpen && (
                          <p className="muted" style={{ textAlign: 'center', marginTop: 12 }}>
                            Bill printed at {new Date(o.closedAt!).toLocaleTimeString()}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
