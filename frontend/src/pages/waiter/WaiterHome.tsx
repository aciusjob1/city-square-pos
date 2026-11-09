import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { listTables } from '../../lib/waiter.api';
import type { TableSummary } from '../../lib/waiter.api';

export function WaiterHome() {
  const { user } = useAuth();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTables().then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setTables(r.data.tables);
      else setError(r.errorMessage ?? 'Failed to load tables');
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <h1>Tables</h1>
      <p className="muted">Signed in as {user?.fullName}</p>

      {error && <div className="error">{error}</div>}

      {!tables && !error && (
        <p className="muted" style={{ marginTop: 24 }}>Loading…</p>
      )}

      {tables && (
        <div className="tables-grid">
          {tables.map((t) => (
            <Link
              key={t.id}
              to={`/waiter/order/${t.id}`}
              className={`table-card${t.activeOrderId ? ' occupied' : ''}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className="table-name">{t.name}</span>
              <span className="table-meta">
                {t.activeOrderId ? 'Active order' : 'Empty'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
