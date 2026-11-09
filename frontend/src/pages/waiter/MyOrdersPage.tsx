import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMyOrders, requestBill, uuid } from '../../lib/waiter.api';

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
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    const r = await listMyOrders();
    if (r.ok && r.data) setOrders(r.data.orders);
    else setError(r.errorMessage ?? 'Failed to load orders');
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onPrintBill = async (orderId: string) => {
    setBillBusy((b) => ({ ...b, [orderId]: true }));
    const res = await requestBill(orderId, uuid());
    setBillBusy((b) => ({ ...b, [orderId]: false }));
    if (res.ok) setToast('Bill requested — printing');
    else setToast(res.errorMessage ?? 'Bill failed');
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
          {orders.map((o) => (
            <div className="order-card" key={o.id}>
              <div className="top">
                <span className="table-name">{o.orderNumber}</span>
                <span className="amount">
                  {o.currency} {parseInt(o.totalAmount, 10).toLocaleString()}
                </span>
              </div>
              <div className="meta">
                <span className="status">{o.status.replace(/_/g, ' ')}</span>
                <span>{new Date(o.serverCreatedAt).toLocaleTimeString()}</span>
              </div>
              <div className="actions">
                <button onClick={() => navigate(`/waiter/order/${o.id}`)} style={{ display: 'none' }} />
                <button
                  onClick={() => onPrintBill(o.id)}
                  disabled={!!billBusy[o.id]}
                >
                  {billBusy[o.id] ? 'Printing…' : 'Print bill'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
