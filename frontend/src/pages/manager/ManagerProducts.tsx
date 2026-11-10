import { useEffect, useState } from 'react';
import {
  listProductsFull,
  createProduct,
  updateProduct,
  deactivateProduct,
  listCategoriesFull,
} from '../../lib/manager.api';
import type { ProductRow, CategoryRow } from '../../lib/manager.api';
import './ManagerProducts.css';

type EditState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; id: string };

const STATIONS = ['KITCHEN', 'BAR', 'NONE'] as const;
type Station = typeof STATIONS[number];

export function ManagerProducts() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [station, setStation] = useState<Station>('KITCHEN');

  async function load() {
    const [prodRes, catRes] = await Promise.all([listProductsFull(), listCategoriesFull()]);
    if (!prodRes.ok || !prodRes.data) {
      setError(prodRes.errorMessage ?? 'Failed to load products');
      return;
    }
    if (catRes.ok && catRes.data) setCategories(catRes.data.categories);
    setError(null);
    setProducts(prodRes.data.products);
    if (!categoryId && catRes.data?.categories[0]) {
      setCategoryId(catRes.data.categories[0].id);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setEdit({ kind: 'none' });
    setName(''); setSku('');
    setSellingPrice('0'); setCostPrice('0');
    setStation('KITCHEN');
  }

  function beginAdd() {
    setEdit({ kind: 'add' });
    setName(''); setSku('');
    setSellingPrice('0'); setCostPrice('0');
    setStation('KITCHEN');
    if (!categoryId && categories[0]) setCategoryId(categories[0].id);
  }

  function beginEdit(p: ProductRow) {
    setEdit({ kind: 'edit', id: p.id });
    setName(p.name);
    setSku(p.sku ?? '');
    setCategoryId(p.categoryId);
    setSellingPrice(String(parseFloat(p.sellingPrice)));
    setCostPrice(String(parseFloat(p.costPrice)));
    setStation(p.preparationStation as Station);
  }

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!categoryId) { setError('Category is required'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      sku: sku.trim() || undefined,
      categoryId,
      sellingPrice: parseFloat(sellingPrice) || 0,
      costPrice: parseFloat(costPrice) || 0,
      preparationStation: station,
    };
    const res = edit.kind === 'add'
      ? await createProduct(payload)
      : edit.kind === 'edit'
        ? await updateProduct(edit.id, payload)
        : { ok: false, errorMessage: 'Unknown state' } as any;
    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Save failed');
      return;
    }
    setToast(edit.kind === 'add' ? 'Product created' : 'Product updated');
    setTimeout(() => setToast(null), 2000);
    resetForm();
    await load();
  }

  async function handleDeactivate(p: ProductRow) {
    if (!confirm(`Deactivate "${p.name}"?`)) return;
    const res = await deactivateProduct(p.id);
    if (!res.ok) { setError(res.errorMessage ?? 'Deactivate failed'); return; }
    setToast('Product deactivated');
    setTimeout(() => setToast(null), 2000);
    await load();
  }

  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? '—';

  const isBelowCost = (sell: string, cost: string) =>
    parseFloat(sell) < parseFloat(cost);

  return (
    <div className="page manager-page">
      <div className="manager-products-header">
        <h2>Products</h2>
        {edit.kind === 'none' && (
          <button className="manager-refresh" onClick={beginAdd}>
            + Add New
          </button>
        )}
      </div>

      {edit.kind !== 'none' && (
        <div className="manager-prod-form">
          <label>Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label>SKU
            <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={30} placeholder="optional" style={{ width: '100px' }} />
          </label>
          <label>Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>Station
            <select value={station} onChange={(e) => setStation(e.target.value as Station)}>
              {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Sell
            <input type="number" min={0} step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} style={{ width: '90px' }} />
          </label>
          <label>Cost
            <input type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} style={{ width: '90px' }} />
          </label>
          <div className="actions">
            <button className="primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!products && !error && <p className="muted">Loading…</p>}
      {products && products.length === 0 && <p className="muted">No products yet.</p>}

      {products && products.length > 0 && (
        <div className="manager-table-scroll">
        <section className="manager-section">
          <table className="manager-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Sell</th>
                <th>Cost</th>
                <th>Station</th>
                <th style={{ width: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const warn = isBelowCost(p.sellingPrice, p.costPrice);
                return (
                  <tr key={p.id} className={warn ? 'manager-prod-warning-row' : ''}>
                    <td>
                      {p.name}
                      {warn && <span className="manager-prod-warning" title="Selling price is below cost price">⚠</span>}
                    </td>
                    <td>{p.sku ?? '—'}</td>
                    <td>{categoryName(p.categoryId)}</td>
                    <td>{parseFloat(p.sellingPrice).toLocaleString()}</td>
                    <td>{parseFloat(p.costPrice).toLocaleString()}</td>
                    <td>{p.preparationStation}</td>
                    <td>
                      <div className="manager-row-actions">
                        <button onClick={() => beginEdit(p)}>Edit</button>
                        <button className="danger" onClick={() => handleDeactivate(p)}>Deactivate</button>
                      </div>
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
