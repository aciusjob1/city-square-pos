import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listOrdersForCashier,
  requestBill,
  getOrder,
  mergeOrders,
  unmergeBillGroup,
  printConsolidatedBill,
  getBillGroup,
} from '../../lib/waiter.api';
import type { FullOrder, BillGroupDetail } from '../../lib/waiter.api';
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
  billGroupId?: string | null;
  waiter: { username: string; fullName: string };
}

type Filter = 'open' | 'closed' | 'all';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
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

  // Merge state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [billGroups, setBillGroups] = useState<Record<string, BillGroupDetail>>({});
  const [groupBusy, setGroupBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    setError(null);
    const r = await listOrdersForCashier();
    if (r.ok && r.data) {
      setOrders(r.data.orders as OrderRow[]);
    } else {
      setError(r.errorMessage ?? 'Failed to load orders');
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Fetch bill-group details for any open orders that belong to one
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

  const counts = useMemo(() => {
    if (!orders) return { open: 0, closed: 0, all: 0 };
    return {
      open: orders.filter((o) => !o.closedAt).length,
      closed: orders.filter((o) => o.closedAt && isToday(o.closedAt)).length,
      all: orders.length,
    };
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

  // Grouped view: hide orders that belong to a bill group, show group row instead
  const visibleRows = useMemo(() => {
    const grouped = new Set<string>();
    const rows: Array<{ kind: 'single'; order: OrderRow } | { kind: 'group'; groupId: string; orders: OrderRow[] }> = [];
    for (const o of filtered) {
      if (o.billGroupId) {
        if (grouped.has(o.billGroupId)) continue;
        grouped.add(o.billGroupId);
        const groupOrders = filtered.filter((x) => x.billGroupId === o.billGroupId);
        rows.push({ kind: 'group', groupId: o.billGroupId, orders: groupOrders });
      } else {
        rows.push({ kind: 'single', order: o });
      }
    }
    return rows;
  }, [filtered]);

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
      setToast(`Merged ${r.data.orderCount} orders into one bill group`);
      setSelectedIds(new Set());
      await load();
    } else {
      setToast(r.errorMessage ?? 'Merge failed');
    }
  };

  const onUnmerge = async (billGroupId: string) => {
    setGroupBusy((b) => ({ ...b, [billGroupId]: true }));
    const r = await unmergeBillGroup(billGroupId);
    setGroupBusy((b) => ({ ...b, [billGroupId]: false }));
    if (r.ok) {
      setToast('Bill group dissolved');
      setBillGroups((g) => {
        const copy = { ...g };
        delete copy[billGroupId];
        return copy;
      });
      await load();
    } else {
      setToast(r.errorMessage ?? 'Unmerge failed');
    }
  };

  const onPrintConsolidated = async (billGroupId: string) => {
    setGroupBusy((b) => ({ ...b, [billGroupId]: true }));
    const r = await printConsolidatedBill(billGroupId);
    setGroupBusy((b) => ({ ...b, [billGroupId]: false }));
    if (r.ok && r.data) {
      setToast(`Consolidated bill printed · ${r.data.currency} ${parseInt(r.data.grandTotal, 10).toLocaleString()}`);
      setBillGroups((g) => {
        const copy = { ...g };
        delete copy[billGroupId];
        return copy;
      });
      await load();
    } else {
      setToast(r.errorMessage ?? 'Print failed');
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
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>
          Open <span className="count">{counts.open}</span>
        </button>
        <button className={filter === 'closed' ? 'active' : ''} onClick={() => setFilter('closed')}>
          Closed today <span className="count">{counts.closed}</span>
        </button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All <span className="count">{counts.all}</span>
        </button>
      </div>

      {selectedIds.size >= 2 && (
        <div className="merge-bar">
          <div className="merge-bar-info">
            <strong>{selectedIds.size} orders selected</strong>
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
        <p className="muted" style={{ marginTop: 24 }}>No orders in this view.</p>
      )}

      {orders && visibleRows.length > 0 && (
        <div className="cashier-list">
          {visibleRows.map((row) => {
            if (row.kind === 'single') {
              const o = row.order;
              const isOpen = !o.closedAt;
              const isExpanded = expandedId === o.id;
              const detail = details[o.id];
              const isLoading = detailsLoading[o.id];
              const isSelected = selectedIds.has(o.id);

              return (
                <div className={`cashier-row${isExpanded ? ' expanded' : ''}`} key={o.id}>
                  <div className="cashier-row-inner">
                    {isOpen && (
                      <label className="cashier-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(o.id)}
                        />
                      </label>
                    )}
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
                        {o.orderType === 'TAKEAWAY' && <span>Takeaway</span>}
                        <span className="time-ago">{timeAgo(o.serverCreatedAt)}</span>
                      </div>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="cashier-details">
                      {isLoading && <p className="muted">Loading details…</p>}
                      {detail && (
                        <>
                          <div className="detail-row"><span>Table</span><span>{detail.table?.name ?? 'Takeaway'}</span></div>
                          <div className="detail-row"><span>Waiter</span><span>{detail.waiter.fullName}</span></div>
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
            }

            // Group row
            const groupId = row.groupId;
            const groupOrders = row.orders;
            const detail = billGroups[groupId];
            const grandTotal = detail?.grandTotal ?? groupOrders.reduce((s, o) => s + parseFloat(o.totalAmount), 0).toFixed(2);
            const currency = groupOrders[0]?.currency ?? 'TZS';
            const allOpen = groupOrders.every((o) => !o.closedAt);
            const busy = groupBusy[groupId];

            return (
              <div className="cashier-row cashier-row-group" key={groupId}>
                <div className="cashier-group-header">
                  <div className="row-main">
                    <span className="order-num">
                      {groupOrders.map((o) => o.orderNumber).join(' + ')}
                    </span>
                    <span className="order-total">{currency} {parseInt(grandTotal, 10).toLocaleString()}</span>
                  </div>
                  <div className="row-meta">
                    <span className="order-badge badge-group">{groupOrders.length} orders · Bill group</span>
                    <span>{groupOrders.map((o) => o.waiter.fullName).join(', ')}</span>
                  </div>
                </div>

                <div className="cashier-group-body">
                  {groupOrders.map((o) => (
                    <div className="cashier-group-order" key={o.id}>
                      <div className="group-order-line">
                        <span className="group-order-num">{o.orderNumber}</span>
                        <span className="group-order-waiter">{o.waiter.fullName}</span>
                        <span className="group-order-total">{currency} {parseInt(o.totalAmount, 10).toLocaleString()}</span>
                      </div>
                      <button className="group-order-expand" onClick={() => onToggleDetails(o.id)}>
                        {expandedId === o.id ? '▾ Hide items' : '▸ Show items'}
                      </button>
                      {expandedId === o.id && details[o.id] && (
                        <div className="cashier-details-inline">
                          {details[o.id].items.map((it) => (
                            <div className="detail-row" key={it.id}>
                              <span>{it.quantity}× {it.productName}</span>
                              <span>{currency} {parseInt(it.lineTotal, 10).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="group-grand-total">
                    <span>GRAND TOTAL</span>
                    <span>{currency} {parseInt(grandTotal, 10).toLocaleString()}</span>
                  </div>

                  {allOpen && (
                    <div className="group-actions">
                      <button
                        className="group-print-btn"
                        onClick={() => onPrintConsolidated(groupId)}
                        disabled={busy}
                      >
                        {busy ? 'Printing…' : 'Print Consolidated Bill'}
                      </button>
                      <button
                        className="group-unmerge-btn"
                        onClick={() => onUnmerge(groupId)}
                        disabled={busy}
                      >
                        Unmerge
                      </button>
                    </div>
                  )}
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
