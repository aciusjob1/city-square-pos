import { useEffect, useState } from 'react';
import { listMyOrders, requestBill, getOrder } from '../../lib/waiter.api';
import type { FullOrder } from '../../lib/waiter.api';

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  totalAmount: string;
  currency: string;
  clientCreatedAt: string;
  serverCreatedAt: string;
  waiter: { username: string; fullName: string };
}

export function MyOrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Expansion state — one order open at a time keeps the list readable
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, FullOrder>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});

  const load = async () => {
    const r = await listMyOrders();
    if (r.ok && r.data) setOrders(r.data.orders);
    else setError(r.errorMessage ?? 'Failed to load orders');
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // On first load, auto-expand the most recent order.
  // This gives the waiter instant visibility into the latest activity
  // without extra taps, and works for both mobile and desktop.
  // We only do this once; the user can collapse it and we won't re-open.
  useEffect(() => {
    if (!orders || orders.length === 0) return;
    if (expandedId !== null) return;

    const firstId = orders[0].id;
    setExpandedId(firstId);

    if (!details[firstId]) {
      setDetailsLoading((s) => ({ ...s, [firstId]: true }));
      getOrder(firstId).then((r) => {
        setDetailsLoading((s) => ({ ...s, [firstId]: false }));
        if (r.ok && r.data) {
          setDetails((d) => ({ ...d, [firstId]: r.data! }));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const onToggleDetails = async (orderId: string) => {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(orderId);

    // Fetch full order if not cached
    if (!details[orderId]) {
      setDetailsLoading((s) => ({ ...s, [orderId]: true }));
      const r = await getOrder(orderId);
      setDetailsLoading((s) => ({ ...s, [orderId]: false }));
      if (r.ok && r.data) {
        setDetails((d) => ({ ...d, [orderId]: r.data! }));
      } else {
        setToast(r.errorMessage ?? 'Failed to load order details');
      }
    }
  };

  const onPrintBill = async (orderId: string) => {
    setBillBusy((b) => ({ ...b, [orderId]: true }));
    const res = await requestBill(orderId);
    setBillBusy((b) => ({ ...b, [orderId]: false }));
    if (res.ok && res.data) {
      setToast(res.data.reprint ? 'Bill re-printed' : 'Bill sent to printer');
      // Refetch list so status/closedAt reflects if relevant
      load();
    } else {
      setToast(res.errorMessage ?? 'Bill failed');
    }
  };

  return (
    <div className="page">
      <h1>My Orders</h1>
      <p className="muted">Orders you have placed</p>

      {error && <div className="error">{error}</div>}
      {!orders && !error && <p className="muted" style={{ marginTop: 24 }}>Loading…</p>}
      {orders && orders.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>No orders yet.</p>
      )}

      {orders && orders.length > 0 && (
        <div className="order-list">
          {orders.map((o) => {
            const isOpen = expandedId === o.id;
            const detail = details[o.id];
            const isLoading = detailsLoading[o.id];

            return (
              <div className="order-card" key={o.id}>
                <div className="top">
                  <span className="table-name">
                    {o.orderNumber}
                    {o.orderType === 'TAKEAWAY' && (
                      <span style={{ marginLeft: 8, fontSize: '0.8rem', color: 'var(--muted)' }}>
                        · Takeaway
                      </span>
                    )}
                  </span>
                  <span className="amount">
                    {o.currency} {parseInt(o.totalAmount, 10).toLocaleString()}
                  </span>
                </div>
                <div className="meta">
                  <span className="status">{o.status.replace(/_/g, ' ')}</span>
                  <span>{new Date(o.serverCreatedAt).toLocaleTimeString()}</span>
                </div>

                <button
                  className="details-toggle"
                  onClick={() => onToggleDetails(o.id)}
                >
                  {isOpen ? '▾ Hide details' : '▸ Show details'}
                </button>

                {isOpen && (
                  <div className="order-details">
                    {isLoading && <p className="muted">Loading details…</p>}

                    {detail && (
                      <>
                        <div className="detail-line">
                          <span>Table</span>
                          <span>{detail.table?.name ?? 'Takeaway'}</span>
                        </div>
                        <div className="detail-line">
                          <span>Waiter</span>
                          <span>{detail.waiter.fullName}</span>
                        </div>

                        <div className="detail-sep" />

                        {detail.items.map((it) => (
                          <div className="detail-line" key={it.id}>
                            <span>
                              {it.quantity}× {it.productName}
                              {it.notes && (
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
                                  » {it.notes}
                                </span>
                              )}
                            </span>
                            <span>{detail.currency} {parseInt(it.lineTotal, 10).toLocaleString()}</span>
                          </div>
                        ))}

                        <div className="detail-sep" />

                        <div className="detail-line">
                          <span>Subtotal</span>
                          <span>{detail.currency} {parseInt(detail.subtotal, 10).toLocaleString()}</span>
                        </div>
                        <div className="detail-line detail-total">
                          <span>TOTAL</span>
                          <span>{detail.currency} {parseInt(detail.totalAmount, 10).toLocaleString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="actions">
                  <button
                    onClick={() => onPrintBill(o.id)}
                    disabled={!!billBusy[o.id]}
                  >
                    {billBusy[o.id] ? 'Printing…' : 'Print bill'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
