import { useEffect, useMemo, useState } from 'react';
import { PageSearch } from '../../components/PageSearch';
import {
  listCategoriesFull,
  createCategory,
  updateCategory,
  deactivateCategory,
} from '../../lib/manager.api';
import type { CategoryRow, CategoryPrinterStation } from '../../lib/manager.api';

const PRINTER_LABELS: Record<CategoryPrinterStation, string> = {
  KITCHEN: 'Kitchen printer',
  BAR: 'Bar printer',
  NONE: 'Receipt printer',
};

type EditState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; id: string };

export function ManagerCategories() {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [printerStation, setPrinterStation] = useState<'' | CategoryPrinterStation>('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  async function load() {
    const res = await listCategoriesFull();
    if (!res.ok || !res.data) {
      setError(res.errorMessage ?? 'Failed to load categories');
      return;
    }
    setError(null);
    setCategories(res.data.categories);
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setEdit({ kind: 'none' });
    setName('');
    setSortOrder('0');
    setPrinterStation('');
  }

  function beginAdd() {
    setEdit({ kind: 'add' });
    setName('');
    setSortOrder('0');
    setPrinterStation('');
  }

  function beginEdit(c: CategoryRow) {
    setEdit({ kind: 'edit', id: c.id });
    setName(c.name);
    setSortOrder(String(c.sortOrder));
    setPrinterStation(c.printerStation ?? '');
  }

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      sortOrder: parseInt(sortOrder || '0', 10) || 0,
      printerStation: printerStation === '' ? null : printerStation,
    };
    const res = edit.kind === 'add'
      ? await createCategory(payload)
      : edit.kind === 'edit'
        ? await updateCategory(edit.id, payload)
        : { ok: false, errorMessage: 'Unknown state' } as any;
    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Save failed');
      return;
    }
    setToast(edit.kind === 'add' ? 'Category created' : 'Category updated');
    setTimeout(() => setToast(null), 2000);
    resetForm();
    await load();
  }

  async function handleDeactivate(c: CategoryRow) {
    if (!confirm(`Deactivate "${c.name}"?`)) return;
    const res = await deactivateCategory(c.id);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Deactivate failed');
      return;
    }
    setToast('Category deactivated');
    setTimeout(() => setToast(null), 2000);
    await load();
  }

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  return (
    <div className="page manager-page">
      <div className="manager-page-header">
        <h2>Categories</h2>
        {edit.kind === 'none' && (
          <button className="manager-refresh" onClick={beginAdd}>
            + Add New
          </button>
        )}
      </div>

      {categories && categories.length > 0 && (
        <PageSearch
          value={query}
          onChange={setQuery}
          placeholder="Search categories…"
          count={`${filteredCategories.length} of ${categories.length}`}
        />
      )}

      {edit.kind !== 'none' && (
        <div className="manager-cat-form">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </label>
          <label>
            Sort order
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              min={0}
              style={{ width: '100px' }}
            />
          </label>
          <label>
            Printer
            <select
              value={printerStation}
              onChange={(e) => setPrinterStation(e.target.value as '' | CategoryPrinterStation)}
            >
              <option value="">Product default (no override)</option>
              <option value="KITCHEN">Kitchen printer</option>
              <option value="BAR">Bar printer</option>
              <option value="NONE">Receipt printer</option>
            </select>
          </label>
          <p className="muted manager-cat-hint">
            Items in this category print at the chosen station. “Receipt printer” sends no
            kitchen/bar ticket — the items appear only on the customer receipt.
          </p>
          <div className="actions">
            <button className="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!categories && !error && <p className="muted">Loading…</p>}
      {categories && categories.length === 0 && (
        <p className="muted">No categories yet.</p>
      )}

      {categories && categories.length > 0 && (
        <section className="manager-section">
          <table className="manager-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Sort order</th>
                <th>Printer</th>
                <th style={{ width: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No categories match your search.</td>
                </tr>
              )}
              {filteredCategories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.sortOrder}</td>
                  <td>
                    {c.printerStation
                      ? PRINTER_LABELS[c.printerStation]
                      : <span className="muted">Product default</span>}
                  </td>
                  <td>
                    <div className="manager-row-actions">
                      <button onClick={() => beginEdit(c)}>Edit</button>
                      <button className="danger" onClick={() => handleDeactivate(c)}>
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
