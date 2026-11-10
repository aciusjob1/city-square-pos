import { useEffect, useMemo, useState } from 'react';
import {
  listMyOrders,
  requestBill,
  getOrder,
  mergeOrders,
  getBillGroup,
} from '../../lib/waiter.api';
import type { FullOrder, BillGroupDetail } from '../../lib/waiter.api';
import './MyOrdersPage.css';

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
  billGroupId?: string | null;
  waiter: { username: string; fullName: string };
}

export function MyOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, FullOrder>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});
  const [billBusy, setBillBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [billGroups, setBillGroups] = useState<Record<string, BillGroupDetail>>({});

  const load = async () => {
    setError(null);
    const r = await listMyOrders();
    if (r.ok && r.data) setOrders(r.data.orders as OrderRow[]);
    else setError(r.errorMessage ?? 'Failed to load orders');
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!orders) return;
    const groupIds = new Set<string>();
    for (const o of orders) {
      if (o.billGroupId && !billGroups[o.billGroupId]) groupIds.add(o.billGroupId);
    }
    for (const gid of groupIds) {
      getBillGroup(gid).then((r) => {
        if (r.ok && r.data) {
          setBillGroups((g) => ({ ...g, [gid]: r.data! }));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const isMergeEligible = (o: OrderRow) => !o.closedAt && !o.billGroupId;

  const toggleSelect = (orderId: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectedOrders = orders?.filter((o) => selectedIds.has(o.id)) ?? [];
  const selectedTotal = selectedOrders.reduce((s, o) => s + parseFloat(o.totalAmount), 0);
  const selectedCurrency = selectedOrders[0]?.currency ?? 'TZS';

  const onMerge = async () => {
    if (selectedIds.size < 2) return;
    setMerging(true);
    const r = await mergeOrders(Array.from(selectedIds));
    setMerging(false);
    if (r.ok && r.data) {
      setToast(`Merged ${r.data.orderCount} of your orders into one bill`);
      setSelectedIds(new Set());
      await load();
    } else {
      setToast(r.errorMessage ?? 'Merge failed');
    }
  };

  const onToggleDetails = async (orderId: string) => {
    if (expandedId === orderId) { setExpandedId(null); return; }
    setExpandedId(orderId);
    if (!details[orderId]) {
      setDetailsLoading((s) => ({ ...s, [orderId]: true }));
      const r = await getOrder(orderId);
      setDetailsLoading((s) => ({ ...s, [orderId]: false }));
      if (r.ok && r.data) setDetails((d) => ({ ...d, [orderId]: r.data! }));
      else setToast(r.errorMessage ?? 'Failed to load details');
    }
  };

  const onPrintBill = async (orderId: string) => {
    setBillBusy((b) => ({ ...b, [orderId]: true }));
    const r = await requestBill(orderId);
    setBillBusy((b) => ({ ...b, [orderId]: false }));
    if (r.ok && r.data) {
      setToast(r.data.reprint ? 'Bill re-printed' : 'Bill sent to printer');
      await load();
    } else {
      setToast(r.errorMessage ?? 'Bill failed');
    }
  };

  const visibleRows = useMemo(() => {
    if (!orders) return [];
    const seenGroups = new Set<string>();
    const rows: Array<{ kind: 'single'; order: OrderRow } | { kind: 'group'; groupId: string; orders: OrderRow[] }> = [];
    for (const o of orders) {
      if (o.billGroupId) {
        if (seenGroups.has(o.billGroupId)) continue;
        seenGroups.add(o.billGroupId);
        const groupOrders = orders.filter((x) => x.billGroupId === o.billGroupId);
        rows.push({ kind: 'group', groupId: o.billGroupId, orders: groupOrders });
      } else {
        rows.push({ kind: 'single', order: o });
      }
    }
    return rows;
  }, [orders]);

  return (
    <div className="page">
      <h1>My Orders</h1>
      <p className="subtitle">Orders you have placed</p>

      {selectedIds.size >= 2 && (
        <div className="merge-bar">
          <div className="merge-bar-info">
            <strong>{selectedIds.size} of your orders selected</strong>
            <span>Combined: {selectedCurrency} {Math.round(selectedTotal).toLocaleString()}</span>
          </div>
          <div className="merge-bar-actions">
            <button
              className="merge-bar-btn"
              onClick={onMerge}
              disabled={merging}
            >
              {merging ? 'Merging…' : 'Merge into one bill'}
            </button>
            <button
              className="merge-bar-cancel"
              onClick={() => setSelectedIds(new Set())}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {!orders && !error && <p className="muted" style={{ marginTop: 24 }}>Loading…</p>}
      {orders && visibleRows.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>No orders yet.</p>
      )}

      {orders && visibleRows.length > 0 && (
        <div className="order-list">
          {visibleRows.map((row) => {
            if (row.kind === 'single') {
              const o = row.order;
              const isExpanded = expandedId === o.id;
              const detail = details[o.id];
              const isLoading = detailsLoading[o.id];
              const isSelected = selectedIds.has(o.id);
              const canMerge = isMergeEligible(o);

              return (
                <div className="order-card" key={o.id}>
                  <div className="order-card-inner">
                    {canMerge && (
                      <label className="order-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(o.id)}
                        />
                      </label>
                    )}
                    <div className="order-card-main">
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

                      <button className="details-toggle" onClick={() => onToggleDetails(o.id)}>
                        {isExpanded ? '▾ Hide details' : '▸ Show details'}
                      </button>

                      {isExpanded && (
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
                  </div>
                </div>
              );
            }

            const groupId = row.groupId;
            const groupOrders = row.orders;
            const detail = billGroups[groupId];
            const grandTotal = detail?.grandTotal ?? groupOrders.reduce((s, o) => s + parseFloat(o.totalAmount), 0).toFixed(2);
            const currency = groupOrders[0]?.currency ?? 'TZS';
            const awaitingCashier = groupOrders.every((o) => !o.closedAt);

            return (
              <div className="order-card order-card-group" key={groupId}>
                <div className="group-header">
                  <div className="group-title">
                    {groupOrders[0].orderType === 'TAKEAWAY' ? 'Takeaway' : 'Table'} · Consolidated orders
                  </div>
                  {awaitingCashier && (
                    <span className="group-badge">Awaiting cashier bill</span>
                  )}
                </div>

                <div className="group-orders">
                  {groupOrders.map((o) => (
                    <div className="group-order" key={o.id}>
                      <div className="group-order-line">
                        <span className="group-order-num">{o.orderNumber}</span>
                        <span className="group-order-waiter">{o.waiter.fullName}</span>
                        <span className="group-order-total">
                          {currency} {parseInt(o.totalAmount, 10).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="group-grand-total">
                  <span>Combined total</span>
                  <span>{currency} {parseInt(grandTotal, 10).toLocaleString()}</span>
                </div>

                <div className="group-footer">
                  {groupOrders.length} {groupOrders.length === 1 ? 'order' : 'orders'} · Your orders
                  {awaitingCashier ? ' · Not yet finalized' : ' · Bill printed'}
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
