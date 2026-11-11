import { useEffect, useState } from 'react';
import {
  listStockBalances,
  restockProduct,
  updateProduct,
} from '../../lib/manager.api';
import type { StockBalanceRow, StockStatus } from '../../lib/manager.api';
import './ManagerStock.css';

type EditState =
  | { kind: 'none' }
  | { kind: 'restock'; productId: string }
  | { kind: 'reorder'; productId: string };

export function ManagerStock() {
  const [rows, setRows] = useState<StockBalanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [saving, setSaving] = useState(false);

  const [restockQty, setRestockQty] = useState('1');
  const [restockNotes, setRestockNotes] = useState('');
  const [reorderVal, setReorderVal] = useState('0');

  async function load() {
    const res = await listStockBalances();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load stock');
      return;
    }
    setError(null);
    setRows(res.data.balances);
  }

  useEffect(() => { load(); }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  function beginRestock(r: StockBalanceRow) {
    setEdit({ kind: 'restock', productId: r.productId });
    setRestockQty('1');
    setRestockNotes('');
  }

  function beginReorder(r: StockBalanceRow) {
    setEdit({ kind: 'reorder', productId: r.productId });
    setReorderVal(String(r.reorderLevel));
  }

  function resetForm() {
    setEdit({ kind: 'none' });
    setRestockQty('1');
    setRestockNotes('');
    setReorderVal('0');
  }

  async function submitRestock() {
    if (edit.kind !== 'restock') return;
    const qty = parseInt(restockQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be a positive integer');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await restockProduct(edit.productId, qty, restockNotes.trim() || undefined);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Restock failed'); return; }
    flash('Stock restocked');
    resetForm();
    await load();
  }

  async function submitReorder() {
    if (edit.kind !== 'reorder') return;
    const val = parseInt(reorderVal, 10);
    if (!Number.isFinite(val) || val < 0) {
      setError('Reorder level must be a non-negative integer');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updateProduct(edit.productId, { reorderLevel: val });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    flash('Reorder level updated');
    resetForm();
    await load();
  }

  const statusClass = (s: StockStatus) =>
    s === 'OK' ? 'manager-stock-ok' : s === 'LOW' ? 'manager-stock-low' : 'manager-stock-out';

  return (
    <div className="page manager-page">
      <div className="manager-stock-header">
        <h2>Stock</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!rows && !error && <p className="muted">Loading…</p>}

      {rows && rows.length > 0 && (
        <div className="manager-table-scroll">
          <section className="manager-section">
            <table className="manager-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Balance</th>
                  <th>Reorder level</th>
                  <th>Status</th>
                  <th style={{ width: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isEditing = edit.kind !== 'none' && edit.productId === r.productId;
                  return (
                    <tr key={r.productId}>
                      <td>{r.productName}</td>
                      <td>{r.balance}</td>
                      <td>
                        {edit.kind === 'reorder' && edit.productId === r.productId ? (
                          <input
                            type="number"
                            min={0}
                            value={reorderVal}
                            onChange={(e) => setReorderVal(e.target.value)}
                            style={{ width: '80px' }}
                            autoFocus
                          />
                        ) : r.reorderLevel}
                      </td>
                      <td>
                        <span className={`manager-stock-pill ${statusClass(r.status)}`}>{r.status}</span>
                      </td>
                      <td>
                        {!isEditing && (
                          <div className="manager-row-actions">
                            <button onClick={() => beginRestock(r)}>Restock</button>
                            <button onClick={() => beginReorder(r)}>Edit reorder</button>
                          </div>
                        )}
                        {edit.kind === 'restock' && edit.productId === r.productId && (
                          <div className="manager-stock-inline">
                            <input
                              type="number"
                              min={1}
                              value={restockQty}
                              onChange={(e) => setRestockQty(e.target.value)}
                              style={{ width: '80px' }}
                              placeholder="Qty"
                              autoFocus
                            />
                            <input
                              type="text"
                              value={restockNotes}
                              onChange={(e) => setRestockNotes(e.target.value)}
                              placeholder="Notes (optional)"
                              style={{ width: '120px' }}
                            />
                            <button className="primary" onClick={submitRestock} disabled={saving}>
                              {saving ? 'Saving…' : 'Add'}
                            </button>
                            <button onClick={resetForm} disabled={saving}>Cancel</button>
                          </div>
                        )}
                        {edit.kind === 'reorder' && edit.productId === r.productId && (
                          <div className="manager-stock-inline">
                            <button className="primary" onClick={submitReorder} disabled={saving}>
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={resetForm} disabled={saving}>Cancel</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
