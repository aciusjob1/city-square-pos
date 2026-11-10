import { useEffect, useState } from 'react';
import {
  listCategoriesFull,
  createCategory,
  updateCategory,
  deactivateCategory,
} from '../../lib/manager.api';
import type { CategoryRow } from '../../lib/manager.api';
import './ManagerCategories.css';

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
  const [saving, setSaving] = useState(false);

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
  }

  function beginAdd() {
    setEdit({ kind: 'add' });
    setName('');
    setSortOrder('0');
  }

  function beginEdit(c: CategoryRow) {
    setEdit({ kind: 'edit', id: c.id });
    setName(c.name);
    setSortOrder(String(c.sortOrder));
  }

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      sortOrder: parseInt(sortOrder || '0', 10) || 0,
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

  return (
    <div className="page manager-page">
      <div className="manager-categories-header">
        <h2>Categories</h2>
        {edit.kind === 'none' && (
          <button className="manager-refresh" onClick={beginAdd}>
            + Add New
          </button>
        )}
      </div>

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
                <th style={{ width: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.sortOrder}</td>
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
