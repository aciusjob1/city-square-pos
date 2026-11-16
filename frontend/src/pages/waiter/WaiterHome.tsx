import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageSearch } from '../../components/PageSearch';
import { listTables } from '../../lib/waiter.api';
import type { TableSummary } from '../../lib/waiter.api';

export function WaiterHome() {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    listTables().then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setTables(r.data.tables);
      else setError(r.errorMessage ?? 'Failed to load tables');
    });
    return () => { cancelled = true; };
  }, []);

  const occupied = tables?.filter((t) => t.activeOrderId).length ?? 0;

  const filteredTables = useMemo(() => {
    if (!tables) return [];
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.activeOrderId ? 'occupied active' : 'empty').includes(q),
    );
  }, [tables, query]);

  return (
    <div className="page">
      <h1>Tables</h1>
      <p className="subtitle">
        {tables ? `${occupied} of ${tables.length} tables occupied` : ''}
      </p>

      {error && <div className="error">{error}</div>}

      <Link to="/waiter/order/takeaway" className="takeaway-cta">
        + New Takeaway Order
      </Link>

      <Link to="/print-jobs" className="secondary-cta">
        Print Jobs
      </Link>

      {tables && tables.length > 0 && (
        <PageSearch
          value={query}
          onChange={setQuery}
          placeholder="Search tables by name or status…"
          count={`${filteredTables.length} of ${tables.length}`}
        />
      )}

      {!tables && !error && (
        <p className="muted" style={{ marginTop: 24 }}>Loading tables…</p>
      )}

      {tables && filteredTables.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>No tables match your search.</p>
      )}

      {filteredTables.length > 0 && (
        <div className="tables-grid">
          {filteredTables.map((t) => (
            <Link
              key={t.id}
              to={`/waiter/order/${t.id}`}
              className={`table-card${t.activeOrderId ? ' occupied' : ''}`}
            >
              <span className="table-name">{t.name}</span>
              <span className="table-meta">
                {t.activeOrderId ? '● Active order' : 'Empty'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
