import { useEffect, useMemo, useState } from 'react';
import { PageSearch } from '../../components/PageSearch';
import {
  listProductsFull,
  listCategoriesFull,
  listProductStockState,
  setProductAvailability,
} from '../../lib/manager.api';
import type { ProductRow, CategoryRow, ProductStockState } from '../../lib/manager.api';
import './SoldOutPage.css';

export function SoldOutPage() {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stock, setStock] = useState<Record<string, ProductStockState>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  async function load() {
    const [prodRes, catRes, stockRes] = await Promise.all([
      listProductsFull(),
      listCategoriesFull(),
      listProductStockState(),
    ]);
    if (!prodRes.ok || !prodRes.data) {
      setError(prodRes.errorMessage ?? 'Failed to load products');
      return;
    }
    if (catRes.ok && catRes.data) setCategories(catRes.data.categories);
    if (stockRes.ok && stockRes.data) {
      setStock(
        Object.fromEntries(stockRes.data.products.map((s) => [s.productId, s])),
      );
    }
    setError(null);
    setProducts(prodRes.data.products);
  }

  useEffect(() => { load(); }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function toggleAvailability(p: ProductRow) {
    const next = p.isAvailable === false;
    setSavingId(p.id);
    setError(null);
    // Optimistic flip; reverted below if the server rejects it.
    setProducts((prev) =>
      prev?.map((x) => (x.id === p.id ? { ...x, isAvailable: next } : x)) ?? prev,
    );
    const res = await setProductAvailability(p.id, next);
    setSavingId(null);
    if (!res.ok) {
      setProducts((prev) =>
        prev?.map((x) => (x.id === p.id ? { ...x, isAvailable: !next } : x)) ?? prev,
      );
      setError(res.errorMessage ?? 'Could not change availability');
      return;
    }
    flash(next ? `${p.name} is back on the menu` : `${p.name} marked sold out`);
  }

  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? '—';

  const soldOutCount = products?.filter((p) => p.isAvailable === false).length ?? 0;
  const outOfStockCount =
    products?.filter((p) => stock[p.id]?.status === 'OUT').length ?? 0;

  function stockText(p: ProductRow): string {
    const s = stock[p.id];
    if (!s) return '';
    if (s.status === 'OUT') return s.limitedByPool ? `out of stock ${s.limitedByPool.name}` : 'out of stock';
    if (s.status === 'LOW') return `low stock ${s.balance}`;
    if (s.status === 'UNTRACKED') return 'not tracked';
    return s.platesLeft !== null ? `${s.platesLeft} plates left` : `${s.balance} on hand`;
  }

  function stockCell(p: ProductRow) {
    const s = stock[p.id];
    if (!s) return <span className="muted">—</span>;
    if (s.status === 'OUT') {
      return (
        <span className="manager-soldout-stock">
          <span className="manager-stock-pill manager-stock-out">Out of stock</span>
          {s.limitedByPool && (
            <span className="manager-soldout-stock-note">{s.limitedByPool.name}</span>
          )}
        </span>
      );
    }
    if (s.status === 'LOW') {
      return (
        <span className="manager-stock-pill manager-stock-low">Low · {s.balance}</span>
      );
    }
    if (s.status === 'UNTRACKED') {
      return <span className="muted">Not tracked</span>;
    }
    return (
      <span className="manager-soldout-stock">
        <span className="manager-stock-pill manager-stock-ok">
          {s.platesLeft !== null
            ? `${s.platesLeft} plates left`
            : `${s.balance} on hand`}
        </span>
        {s.limitedByPool && (
          <span className="manager-soldout-stock-note">{s.limitedByPool.name}</span>
        )}
      </span>
    );
  }

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      categoryName(p.categoryId).toLowerCase().includes(q) ||
      (p.isAvailable === false ? 'sold out' : 'available').includes(q) ||
      stockText(p).includes(q),
    );
  }, [products, query, categories, stock]);

  return (
    <div className="page manager-page">
      <div className="manager-page-header">
        <h2>Sold Out</h2>
        {products && (
          <span className="manager-soldout-count">
            {soldOutCount} of {products.length} sold out
            {outOfStockCount > 0 && ` · ${outOfStockCount} out of stock`}
          </span>
        )}
      </div>

      <p className="muted">
        Turn availability off for a product to mark it sold out. Sold-out products
        disappear from the waiter ordering screen and cannot be ordered. The Stock
        column mirrors the Stock page, including shared ingredient pools.
      </p>

      {products && products.length > 0 && (
        <PageSearch
          value={query}
          onChange={setQuery}
          placeholder="Search products by name, category or status…"
          count={`${filteredProducts.length} of ${products.length}`}
        />
      )}

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!products && !error && <p className="muted">Loading…</p>}

      {products && (
        <div className="manager-table-scroll">
          <section className="manager-section">
            <table className="manager-table manager-soldout-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>No products match your search.</td>
                  </tr>
                )}
                {filteredProducts.map((p) => {
                  const available = p.isAvailable !== false;
                  return (
                    <tr key={p.id} className={available ? '' : 'manager-soldout-row'}>
                      <td>{p.name}</td>
                      <td>{categoryName(p.categoryId)}</td>
                      <td>{parseFloat(p.sellingPrice).toLocaleString()}</td>
                      <td>{stockCell(p)}</td>
                      <td>
                        <div className="manager-soldout-status">
                          <span
                            className={`manager-soldout-pill ${available ? 'available' : 'soldout'}`}
                          >
                            {available ? 'Available' : 'Sold out'}
                          </span>
                          {available && stock[p.id]?.status === 'OUT' && (
                            <span className="manager-soldout-warn">No stock</span>
                          )}
                          <label className="manager-soldout-switch">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`${p.name} available`}
                              checked={available}
                              disabled={savingId === p.id}
                              onChange={() => toggleAvailability(p)}
                            />
                            <span className="manager-soldout-slider" />
                          </label>
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
