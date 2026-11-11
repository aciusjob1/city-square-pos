import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { listTables } from '../../lib/waiter.api';
import type { TableSummary } from '../../lib/waiter.api';
import '../../dashboard-upgrade.css';

export function WaiterHome() {
  const { user } = useAuth();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTables().then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) {
        setTables(r.data.tables);
        setError(null);
      } else {
        setError(r.errorMessage ?? 'Failed to load tables');
      }
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('Unable to connect to the server. Check your connection and retry.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const retry = () => {
    setError(null);
    setLoading(true);
    listTables().then((r) => {
      if (r.ok && r.data) setTables(r.data.tables);
      else setError(r.errorMessage ?? 'Failed to load tables');
      setLoading(false);
    }).catch(() => {
      setError('Unable to connect to the server. Check your connection and retry.');
      setLoading(false);
    });
  };

  return (
    <main className="page waiter-dashboard">
      <header className="waiter-dashboard-header">
        <div>
          <h1>Floor overview</h1>
          <p className="subtitle">Welcome, {user?.fullName}. Choose a table or start a takeaway order.</p>
        </div>
        <button className="dashboard-action" type="button" onClick={retry} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh tables'}
        </button>
      </header>

      <Link to="/waiter/order/takeaway" className="takeaway-cta">
        <span aria-hidden="true">＋</span> New takeaway order
      </Link>

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button className="dashboard-action" type="button" onClick={retry}>Try again</button>
        </div>
      )}

      {loading && !tables && <p className="muted" role="status">Loading tables…</p>}
      {tables && tables.length === 0 && !error && (
        <section className="card" aria-live="polite">
          <h2>No active tables</h2>
          <p className="muted">There are no tables available right now. You can still create a takeaway order.</p>
        </section>
      )}
      {tables && tables.length > 0 && (
        <section aria-label="Restaurant tables">
          <h2>Tables <span className="muted">({tables.length})</span></h2>
          <div className="tables-grid">
            {tables.map((table) => (
              <Link
                key={table.id}
                to={`/waiter/order/${table.id}`}
                className={`table-card${table.activeOrderId ? ' occupied' : ''}`}
                aria-label={`${table.name}, ${table.activeOrderId ? 'active order' : 'empty'}`}
              >
                <span className="table-name">{table.name}</span>
                <span className="table-meta">{table.activeOrderId ? 'Active order' : 'Ready for guests'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
