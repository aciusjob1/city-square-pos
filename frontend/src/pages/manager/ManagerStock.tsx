import { useEffect, useMemo, useRef, useState } from 'react';
import { PageSearch } from '../../components/PageSearch';
import {
  listStockBalances,
  listProductsFull,
  restockProduct,
  updateProduct,
} from '../../lib/manager.api';
import type { StockBalanceRow, StockStatus, ProductRow } from '../../lib/manager.api';
import { ManagerStockPools } from './ManagerStockPools';
import type { ManagerStockPoolsHandle } from './ManagerStockPools';
import './ManagerStock.css';

type EditState =
  | { kind: 'none' }
  | { kind: 'restock'; productId: string }
  | { kind: 'reorder'; productId: string };

type StockTab = 'dishes' | 'pools';

export function ManagerStock() {
  const [tab, setTab] = useState<StockTab>('dishes');
  const poolsRef = useRef<ManagerStockPoolsHandle>(null);
  const [rows, setRows] = useState<StockBalanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const [restockQty, setRestockQty] = useState('1');
  const [restockNotes, setRestockNotes] = useState('');
  const [reorderVal, setReorderVal] = useState('0');

  const [allProducts, setAllProducts] = useState<ProductRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [addNotes, setAddNotes] = useState('');
  const [addTrack, setAddTrack] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

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

  async function openAddStock() {
    setAddOpen(true);
    setError(null);
    if (allProducts) return;
    const res = await listProductsFull();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load products');
      return;
    }
    setAllProducts(res.data.products);
    if (!addProductId && res.data.products[0]) setAddProductId(res.data.products[0].id);
  }

  function closeAddStock() {
    setAddOpen(false);
    setAddQty('1');
    setAddNotes('');
    setAddTrack(true);
  }

  async function submitAddStock() {
    if (!addProductId) { setError('Choose a product'); return; }
    const qty = parseInt(addQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be a positive integer');
      return;
    }
    const product = allProducts?.find((p) => p.id === addProductId);
    setAddSaving(true);
    setError(null);
    const res = await restockProduct(addProductId, qty, addNotes.trim() || undefined);
    if (!res.ok) {
      setAddSaving(false);
      setError(res.errorMessage ?? 'Add stock failed');
      return;
    }
    // Adding stock through this screen implies the product should be tracked,
    // otherwise the movement would never show up in balances.
    if (addTrack && product && !product.stockManaged) {
      const upd = await updateProduct(addProductId, { stockManaged: true });
      if (!upd.ok) {
        setAddSaving(false);
        setError(upd.errorMessage ?? 'Stock added, but enabling tracking failed');
        await load();
        return;
      }
    }
    setAddSaving(false);
    flash('Stock added');
    closeAddStock();
    await load();
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

  const addProduct = allProducts?.find((p) => p.id === addProductId) ?? null;

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.productName.toLowerCase().includes(q) ||
      (r.categoryName ?? '').toLowerCase().includes(q) ||
      (r.sku ?? '').toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Same product name can exist in different categories (e.g. several
  // "Sato" dishes). Category + SKU keep stock rows and the picker unambiguous.
  const stockLabel = (name: string, category?: string | null, sku?: string | null) => {
    const base = category ? `${name} · ${category}` : name;
    return sku ? `${base} (${sku})` : base;
  };

  return (
    <div className="page manager-page">
      <div className="manager-page-header">
        <h2>Stock</h2>
        {tab === 'dishes' && (
          <button className="primary" onClick={openAddStock} disabled={addOpen}>
            + Add Stock
          </button>
        )}
        {tab === 'pools' && (
          <button className="primary" onClick={() => poolsRef.current?.beginCreate()}>
            + New Pool
          </button>
        )}
      </div>

      <div className="manager-stock-tabs">
        <button
          className={`manager-stock-tab${tab === 'dishes' ? ' manager-stock-tab-active' : ''}`}
          onClick={() => setTab('dishes')}
        >
          Dish stock
        </button>
        <button
          className={`manager-stock-tab${tab === 'pools' ? ' manager-stock-tab-active' : ''}`}
          onClick={() => setTab('pools')}
        >
          Raw pools
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {tab === 'pools' ? (
        <ManagerStockPools ref={poolsRef} onFlash={flash} />
      ) : (
        <>
      {rows && rows.length > 0 && (
        <PageSearch
          value={query}
          onChange={setQuery}
          placeholder="Search stock by product or status…"
          count={`${filteredRows.length} of ${rows.length}`}
        />
      )}

      {error && <div className="error">{error}</div>}

      {addOpen && (
        <section className="manager-stock-addform">
          <label>Product
            <select
              value={addProductId}
              onChange={(e) => setAddProductId(e.target.value)}
            >
              {!allProducts && <option value="">Loading…</option>}
              {allProducts?.map((p) => (
                <option key={p.id} value={p.id}>
                  {stockLabel(p.name, p.categoryName, p.sku)}
                </option>
              ))}
            </select>
          </label>
          <label>Quantity
            <input
              type="number"
              min={1}
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
              style={{ width: '90px' }}
              autoFocus
            />
          </label>
          <label>Notes (optional)
            <input
              type="text"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="e.g. delivery from supplier"
              style={{ width: '200px' }}
            />
          </label>
          <label className="manager-stock-check">
            <input
              type="checkbox"
              checked={addProduct?.stockManaged ? true : addTrack}
              disabled={!!addProduct?.stockManaged}
              onChange={(e) => setAddTrack(e.target.checked)}
            />
            Track this product in stock
          </label>
          <div className="actions">
            <button className="primary" onClick={submitAddStock} disabled={addSaving || !addProductId}>
              {addSaving ? 'Saving…' : 'Add Stock'}
            </button>
            <button onClick={closeAddStock} disabled={addSaving}>Cancel</button>
          </div>
        </section>
      )}

      {!rows && !error && <p className="muted">Loading…</p>}

      {rows && rows.length === 0 && (
        <p className="muted">
          No products are tracked in stock yet. Use “Add Stock” to receive stock for a product.
        </p>
      )}

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
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>No stock rows match your search.</td>
                  </tr>
                )}
                {filteredRows.map((r) => {
                  const isEditing = edit.kind !== 'none' && edit.productId === r.productId;
                  return (
                    <tr key={r.productId}>
                      <td>
                        <div className="manager-stock-name">
                          <span>{r.productName}</span>
                          {!r.isAvailable && (
                            <span className="manager-stock-pill manager-stock-unavailable">
                              Sold out
                            </span>
                          )}
                        </div>
                        {(r.categoryName || r.sku) && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[r.categoryName, r.sku].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
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
        </>
      )}
    </div>
  );
}
