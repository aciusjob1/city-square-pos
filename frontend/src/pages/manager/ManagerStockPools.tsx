import { useEffect, useImperativeHandle, useState } from 'react';
import type { Ref } from 'react';
import {
  createStockPool,
  listPoolRecipes,
  listProductsFull,
  listStockPools,
  removePoolRecipe,
  restockPool,
  updateStockPool,
  upsertPoolRecipe,
} from '../../lib/manager.api';
import type {
  PoolRecipeRow,
  PoolUnit,
  ProductRow,
  StockPoolRow,
  StockStatus,
} from '../../lib/manager.api';
import './ManagerStock.css';

type View =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'restock'; poolId: string }
  | { kind: 'edit'; poolId: string }
  | { kind: 'recipes'; poolId: string };

const UNIT_LABEL: Record<PoolUnit, string> = {
  G: 'g',
  ML: 'ml',
  PIECES: 'pcs',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

const isCounted = (unit: PoolUnit) => unit === 'PIECES';
const qtyStep = (unit: PoolUnit) => (isCounted(unit) ? '1' : '0.01');
const qtyMin = (unit: PoolUnit) => (isCounted(unit) ? 1 : 0.01);

export type ManagerStockPoolsHandle = { beginCreate: () => void };

type Props = {
  onFlash: (msg: string) => void;
  ref?: Ref<ManagerStockPoolsHandle>;
};

export function ManagerStockPools({ onFlash, ref }: Props) {
  const [pools, setPools] = useState<StockPoolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'none' });
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState<PoolUnit>('G');
  const [reorder, setReorder] = useState('0');

  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');

  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [recipes, setRecipes] = useState<PoolRecipeRow[] | null>(null);
  const [recipeProductId, setRecipeProductId] = useState('');
  const [recipeQty, setRecipeQty] = useState('1');

  async function load() {
    const res = await listStockPools();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load pools');
      return;
    }
    setError(null);
    setPools(res.data.pools);
  }

  useEffect(() => { load(); }, []);

  async function ensureProducts(): Promise<ProductRow[]> {
    if (products) return products;
    const res = await listProductsFull();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load products');
      return [];
    }
    setProducts(res.data.products);
    return res.data.products;
  }

  function reset() {
    setView({ kind: 'none' });
    setName('');
    setUnit('G');
    setReorder('0');
    setQty('1');
    setNotes('');
    setRecipes(null);
    setRecipeProductId('');
    setRecipeQty('1');
  }

  function beginCreate() {
    // Re-clicking the header button while the form is open must not wipe
    // whatever the manager has already typed.
    if (view.kind === 'create') return;
    reset();
    setView({ kind: 'create' });
  }

  useImperativeHandle(ref, () => ({ beginCreate }));

  function beginRestock(pool: StockPoolRow) {
    reset();
    setView({ kind: 'restock', poolId: pool.id });
  }

  function beginEdit(pool: StockPoolRow) {
    reset();
    setName(pool.name);
    setUnit(pool.unit);
    setReorder(String(pool.reorderLevel));
    setView({ kind: 'edit', poolId: pool.id });
  }

  async function beginRecipes(pool: StockPoolRow) {
    reset();
    setView({ kind: 'recipes', poolId: pool.id });
    const list = await ensureProducts();
    const res = await listPoolRecipes(pool.id);
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load dishes');
      return;
    }
    setRecipes(res.data.recipes);
    const first = (list.find((p) => p.isAvailable !== false) ?? list[0])?.id;
    if (first) setRecipeProductId(first);
  }

  function parseQty(
    raw: string,
    label: string,
    unit: PoolUnit,
    allowFraction = false,
  ): number | null {
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= 0) {
      setError(`${label} must be a positive number`);
      return null;
    }
    if (!allowFraction && isCounted(unit) && !Number.isInteger(val)) {
      setError(`${label} must be a whole number — pieces are counted one by one`);
      return null;
    }
    return Math.round(val * 100) / 100;
  }

  function parseReorder(raw: string, unit: PoolUnit): number | null {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < 0) {
      setError('Reorder level must be a non-negative number');
      return null;
    }
    if (isCounted(unit) && !Number.isInteger(val)) {
      setError('Reorder level must be a whole number for a piece-counted pool');
      return null;
    }
    return Math.round(val * 100) / 100;
  }

  async function submitCreate() {
    if (!name.trim()) { setError('Pool name is required'); return; }
    const level = parseReorder(reorder, unit);
    if (level === null) return;
    setSaving(true);
    setError(null);
    const res = await createStockPool({
      name: name.trim(),
      unit,
      reorderLevel: level,
    });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Create pool failed'); return; }
    onFlash('Pool created');
    reset();
    await load();
  }

  async function submitEdit(poolId: string) {
    if (!name.trim()) { setError('Pool name is required'); return; }
    const level = parseReorder(reorder, unit);
    if (level === null) return;
    setSaving(true);
    setError(null);
    const res = await updateStockPool(poolId, {
      name: name.trim(),
      unit,
      reorderLevel: level,
    });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Update pool failed'); return; }
    onFlash('Pool updated');
    reset();
    await load();
  }

  async function submitRestock(poolId: string, unit: PoolUnit) {
    const amount = parseQty(qty, 'Quantity', unit);
    if (amount === null) return;
    setSaving(true);
    setError(null);
    const res = await restockPool(poolId, amount, notes.trim() || undefined);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Add stock failed'); return; }
    onFlash('Pool stock added');
    reset();
    await load();
  }

  async function submitRecipe(poolId: string, unit: PoolUnit) {
    if (!recipeProductId) { setError('Choose a dish'); return; }
    const amount = parseQty(recipeQty, 'Quantity per plate', unit, true);
    if (amount === null) return;
    setSaving(true);
    setError(null);
    const res = await upsertPoolRecipe(poolId, recipeProductId, amount);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Link dish failed'); return; }
    const reload = await listPoolRecipes(poolId);
    if (reload.ok && reload.data) setRecipes(reload.data.recipes);
    onFlash('Dish linked');
    setRecipeQty('1');
    await load();
  }

  async function unlinkRecipe(poolId: string, productId: string) {
    setSaving(true);
    setError(null);
    const res = await removePoolRecipe(poolId, productId);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Unlink failed'); return; }
    setRecipes((cur) => cur?.filter((r) => r.productId !== productId) ?? null);
    onFlash('Dish unlinked');
    await load();
  }

  const statusClass = (s: StockStatus) =>
    s === 'OK' ? 'manager-stock-ok' : s === 'LOW' ? 'manager-stock-low' : 'manager-stock-out';

  const activePool = view.kind === 'recipes' || view.kind === 'restock' || view.kind === 'edit'
    ? pools?.find((p) => p.id === view.poolId) ?? null
    : null;

  const productLabel = (p: ProductRow) =>
    [p.name, p.categoryName, p.sku].filter(Boolean).join(' · ');

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <p className="muted" style={{ margin: '0 0 12px' }}>
        A pool is shared raw stock (e.g. Sato meat or whole chickens). Link the
        dishes that use it and each sale deducts its recipe quantity — a dish may
        use a whole piece or a fraction of one.
      </p>

      {view.kind === 'create' && (
        <section className="manager-stock-addform">
          <label>Pool name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sato meat"
              style={{ width: '200px' }}
              autoFocus
            />
          </label>
          <label>Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as PoolUnit)}>
              <option value="G">grams (g)</option>
              <option value="ML">millilitres (ml)</option>
              <option value="PIECES">pieces (pcs)</option>
            </select>
          </label>
          {isCounted(unit) && (
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              Stock is whole pieces; dishes can use fractions
            </span>
          )}
          <label>Reorder level
            <input
              type="number"
              min={0}
              step={qtyStep(unit)}
              value={reorder}
              onChange={(e) => setReorder(e.target.value)}
              style={{ width: '100px' }}
            />
          </label>
          <div className="actions">
            <button className="primary" onClick={submitCreate} disabled={saving}>
              {saving ? 'Saving…' : 'Create Pool'}
            </button>
            <button onClick={reset} disabled={saving}>Cancel</button>
          </div>
        </section>
      )}

      {pools === null && !error && <p className="muted">Loading pools…</p>}

      {pools && pools.length === 0 && view.kind !== 'create' && (
        <p className="muted">
          No raw pools yet. Create one, add received stock, then link the dishes that use it.
        </p>
      )}

      {pools && pools.length > 0 && (
        <div className="manager-table-scroll">
          <section className="manager-section">
            <table className="manager-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th>Dishes</th>
                  <th style={{ width: '260px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => {
                  const unitLabel = UNIT_LABEL[p.unit];
                  const isRestock = view.kind === 'restock' && view.poolId === p.id;
                  const isEdit = view.kind === 'edit' && view.poolId === p.id;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div>{p.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {unitLabel} · reorder {fmt(p.reorderLevel)}
                        </div>
                      </td>
                      <td>{fmt(p.physical)} {unitLabel}</td>
                      <td>{fmt(p.reserved)} {unitLabel}</td>
                      <td>{fmt(p.available)} {unitLabel}</td>
                      <td>
                        <span className={`manager-stock-pill ${statusClass(p.status)}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>{p.productCount}</td>
                      <td>
                        {!isRestock && !isEdit && (
                          <div className="manager-row-actions">
                            <button onClick={() => beginRestock(p)}>Add stock</button>
                            <button onClick={() => beginRecipes(p)}>Dishes</button>
                            <button onClick={() => beginEdit(p)}>Edit</button>
                          </div>
                        )}
                        {isRestock && (
                          <div className="manager-stock-inline">
                            <input
                              type="number"
                              min={qtyMin(p.unit)}
                              step={qtyStep(p.unit)}
                              value={qty}
                              onChange={(e) => setQty(e.target.value)}
                              style={{ width: '90px' }}
                              placeholder={`Qty (${unitLabel})`}
                              autoFocus
                            />
                            <input
                              type="text"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Notes (optional)"
                              style={{ width: '120px' }}
                            />
                            <button
                              className="primary"
                              onClick={() => submitRestock(p.id, p.unit)}
                              disabled={saving}
                            >
                              {saving ? 'Saving…' : 'Add'}
                            </button>
                            <button onClick={reset} disabled={saving}>Cancel</button>
                          </div>
                        )}
                        {isEdit && (
                          <div className="manager-stock-inline">
                            <input
                              type="text"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              style={{ width: '130px' }}
                              autoFocus
                            />
                            <select value={unit} onChange={(e) => setUnit(e.target.value as PoolUnit)}>
                              <option value="G">g</option>
                              <option value="ML">ml</option>
                              <option value="PIECES">pcs</option>
                            </select>
                            <input
                              type="number"
                              min={0}
                              step={qtyStep(unit)}
                              value={reorder}
                              onChange={(e) => setReorder(e.target.value)}
                              style={{ width: '80px' }}
                              title="Reorder level"
                            />
                            <button
                              className="primary"
                              onClick={() => submitEdit(p.id)}
                              disabled={saving}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={reset} disabled={saving}>Cancel</button>
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

      {view.kind === 'recipes' && activePool && (
        <section className="manager-stock-addform" style={{ display: 'block' }}>
          <div className="manager-section-header" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>
              Dishes using {activePool.name} ({UNIT_LABEL[activePool.unit]} per plate)
            </h3>
            <button className="manager-refresh" onClick={reset}>Close</button>
          </div>

          {recipes === null && <p className="muted">Loading dishes…</p>}
          {recipes && recipes.length === 0 && (
            <p className="muted">No dishes linked yet.</p>
          )}
          {recipes && recipes.length > 0 && (
            <table className="manager-table">
              <thead>
                <tr>
                  <th>Dish</th>
                  <th>Per plate</th>
                  <th style={{ width: '90px' }} />
                </tr>
              </thead>
              <tbody>
                {recipes.map((r) => (
                  <tr key={r.productId}>
                    <td>
                      <div>{r.productName}</div>
                      {(r.categoryName || r.sku) && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[r.categoryName, r.sku].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>{fmt(r.quantityPerUnit)} {UNIT_LABEL[activePool.unit]}</td>
                    <td>
                      <button
                        onClick={() => unlinkRecipe(activePool.id, r.productId)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="manager-stock-inline" style={{ marginTop: 12 }}>
            <select
              value={recipeProductId}
              onChange={(e) => setRecipeProductId(e.target.value)}
              style={{ minWidth: '240px' }}
            >
              {!products && <option value="">Loading…</option>}
              {products?.filter((p) => p.isAvailable !== false).map((p) => (
                <option key={p.id} value={p.id}>{productLabel(p)}</option>
              ))}
            </select>
            <input
              type="number"
              min={0.01}
              step="any"
              value={recipeQty}
              onChange={(e) => setRecipeQty(e.target.value)}
              style={{ width: '110px' }}
              placeholder={`Qty (${UNIT_LABEL[activePool.unit]})`}
              title={
                isCounted(activePool.unit)
                  ? 'Fraction of a piece allowed, e.g. 0.25 for a quarter'
                  : undefined
              }
            />
            <button
              className="primary"
              onClick={() => submitRecipe(activePool.id, activePool.unit)}
              disabled={saving || !recipeProductId}
            >
              {saving ? 'Saving…' : 'Link dish'}
            </button>
          </div>
          {isCounted(activePool.unit) && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Quarter piece = 0.25, half = 0.5, whole = 1. Each sale deducts that
              fraction from the pool.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
