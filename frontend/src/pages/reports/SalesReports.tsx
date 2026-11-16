import { useEffect, useMemo, useState } from 'react';
import { getMySales, getSalesSummary } from '../../lib/reports.api';
import type { SalesSummary, TrendGranularity } from '../../lib/reports.api';
import './SalesReports.css';

const TZ = 'Africa/Dar_es_Salaam';

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

const GRANULARITIES: Array<{ id: TrendGranularity; label: string }> = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'year', label: 'Yearly' },
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function businessToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function addDays(iso: string, delta: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const { y, m, d } = businessToday();
  const today = isoFromParts(y, m, d);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      const sinceMonday = (dow + 6) % 7;
      return { from: addDays(today, -sinceMonday), to: today };
    }
    case 'month':
      return { from: isoFromParts(y, m, 1), to: today };
    case 'year':
      return { from: isoFromParts(y, 1, 1), to: today };
  }
}

// Waiters pick a period only; the group-by is derived so the page keeps a
// single filter row instead of two competing ones.
function autoGranularity(preset: Preset, from: string, to: string): TrendGranularity {
  if (preset === 'year') return 'month';
  if (preset !== 'custom') return 'day';
  const span =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (span <= 31) return 'day';
  if (span <= 366) return 'month';
  return 'year';
}

function trendLabel(period: string, granularity: TrendGranularity): string {
  if (granularity === 'year') return period;
  if (granularity === 'week') {
    const [y, w] = period.split('-W');
    return `W${w} ${y}`;
  }
  if (granularity === 'month') {
    const [y, m] = period.split('-').map((v) => parseInt(v, 10));
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return new Date(`${period}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function SalesReports({ mine = false }: { mine?: boolean }) {
  const initial = presetRange('today');
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [query, setQuery] = useState('');
  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<TrendGranularity>('day');
  const [waiterOptions, setWaiterOptions] = useState<
    Array<{ id: string; full_name: string; username: string }>
  >([]);
  const [data, setData] = useState<SalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const businessDate = businessToday();
  const today = isoFromParts(businessDate.y, businessDate.m, businessDate.d);

  useEffect(() => {
    let cancelled = false;
    if (from > to) {
      setError('Start date must be on or before end date.');
      return;
    }
    setError(null);
    setLoading(true);
    const effectiveGranularity = mine ? autoGranularity(preset, from, to) : granularity;
    const request = mine
      ? getMySales(from, to, effectiveGranularity)
      : getSalesSummary(from, to, { waiterId, productId, granularity });
    request.then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) setData(res.data);
      else setError(res.errorMessage ?? 'Failed to load sales report');
    });
    return () => { cancelled = true; };
  }, [from, to, waiterId, productId, granularity, preset, reloadKey, mine]);

  // Keep every waiter seen so far in the picker: once a waiter is selected
  // the response only contains that waiter, and the picker must not shrink.
  useEffect(() => {
    if (!data || mine) return;
    setWaiterOptions((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      for (const w of data.byWaiter) {
        if (!byId.has(w.id)) {
          byId.set(w.id, { id: w.id, full_name: w.full_name, username: w.username });
        }
      }
      if (data.filters.waiter && !byId.has(data.filters.waiter.id)) {
        byId.set(data.filters.waiter.id, {
          id: data.filters.waiter.id,
          full_name: data.filters.waiter.fullName,
          username: data.filters.waiter.username,
        });
      }
      return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
    });
  }, [data, mine]);

  function applyPreset(next: Preset) {
    setPreset(next);
    if (next !== 'custom') {
      const range = presetRange(next);
      setFrom(range.from);
      setTo(range.to);
      setGranularity(next === 'year' ? 'month' : 'day');
    }
  }

  const toggleProduct = (id: string) => {
    setProductId((cur) => (cur === id ? null : id));
  };

  const toggleWaiter = (id: string) => {
    setWaiterId((cur) => (cur === id ? null : id));
  };

  const term = query.trim().toLowerCase();
  const products = useMemo(() => {
    if (!data) return [];
    if (!term) return data.byProduct;
    return data.byProduct.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.category ?? '').toLowerCase().includes(term),
    );
  }, [data, term]);

  const waiters = useMemo(() => {
    if (!data) return [];
    if (!term) return data.byWaiter;
    return data.byWaiter.filter(
      (w) =>
        w.full_name.toLowerCase().includes(term) ||
        w.username.toLowerCase().includes(term),
    );
  }, [data, term]);

  const money = (value: string) =>
    `${data?.currency ?? 'TZS'} ${parseInt(value, 10).toLocaleString()}`;

  const maxTrend = data && data.trend.rows.length > 0
    ? Math.max(...data.trend.rows.map((r) => parseFloat(r.total)))
    : 0;

  return (
    <div className="page reports-page">
      <header className="reports-header">
        <div>
          <h1>{mine ? 'My Sales' : 'Sales Reports'}</h1>
          <p className="subtitle">
            {mine ? 'Your own sales' : 'Product and waiter totals'}
            {' · '}
            {from === to ? from : `${from} → ${to}`}
          </p>
        </div>
        <button
          className="reports-refresh"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
        >
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </header>

      <div className="reports-periods" role="group" aria-label="Report period">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'active' : ''}
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!mine && (
        <div className="reports-periods" role="group" aria-label="Group sales by">
          <span className="reports-periods-label">Group by</span>
          {GRANULARITIES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={granularity === g.id ? 'active' : ''}
              onClick={() => setGranularity(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      <div className="reports-controls">
        {(!mine || preset === 'custom') && (
          <>
            <label>
              From
              <input
                type="date"
                value={from}
                max={today}
                onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                max={today}
                onChange={(e) => { setPreset('custom'); setTo(e.target.value); }}
              />
            </label>
          </>
        )}
        {!mine && (
          <label>
            Waiter
            <select
              value={waiterId ?? ''}
              onChange={(e) => setWaiterId(e.target.value || null)}
            >
              <option value="">All waiters</option>
              {waiterOptions.map((w) => (
                <option key={w.id} value={w.id}>{w.full_name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="reports-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mine
                ? 'Search product or category…'
                : 'Search product, category or waiter…'
            }
            aria-label={
              mine ? 'Search product or category' : 'Search product, category or waiter'
            }
          />
        </div>
      </div>

      {data && (data.filters.product || (!mine && data.filters.waiter)) && (
        <div className="reports-chips">
          <span className="reports-chips-label">Filtered to</span>
          {!mine && data.filters.waiter && (
            <button
              type="button"
              className="reports-chip"
              onClick={() => setWaiterId(null)}
              title="Remove waiter filter"
            >
              Waiter: {data.filters.waiter.fullName} <span aria-hidden="true">×</span>
            </button>
          )}
          {data.filters.product && (
            <button
              type="button"
              className="reports-chip"
              onClick={() => setProductId(null)}
              title="Remove product filter"
            >
              Product: {data.filters.product.name} <span aria-hidden="true">×</span>
            </button>
          )}
          <button
            type="button"
            className="reports-chip-clear"
            onClick={() => { setWaiterId(null); setProductId(null); }}
          >
            Clear all
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <>
          <div className="reports-kpis">
            <div className="reports-kpi">
              <span className="reports-kpi-label">Total sales</span>
              <span className="reports-kpi-value">{money(data.summary.totalSales)}</span>
            </div>
            <div className="reports-kpi">
              <span className="reports-kpi-label">Orders</span>
              <span className="reports-kpi-value">{data.summary.orderCount}</span>
            </div>
            <div className="reports-kpi">
              <span className="reports-kpi-label">Items sold</span>
              <span className="reports-kpi-value">{data.summary.itemCount}</span>
            </div>
            <div className="reports-kpi">
              <span className="reports-kpi-label">Avg order</span>
              <span className="reports-kpi-value">{money(data.summary.avgOrderValue)}</span>
            </div>
          </div>

          {data.summary.cancelledCount > 0 && (
            <p className="reports-note">
              {data.summary.cancelledCount} cancelled order
              {data.summary.cancelledCount === 1 ? '' : 's'} excluded
              {' '}({money(data.summary.cancelledTotal)}).
            </p>
          )}

          {data.trend.rows.length > 0 && (
            <section className="reports-section">
              <div className="reports-section-head">
                <h2>
                  {mine
                    ? 'My sales trend'
                    : data.filters.waiter
                      ? `${data.filters.waiter.fullName} — sales trend`
                      : 'Sales trend'}
                </h2>
                <span className="muted">
                  {data.trend.granularity === 'day'
                    ? 'daily'
                    : data.trend.granularity === 'week'
                      ? 'weekly'
                      : data.trend.granularity === 'month'
                        ? 'monthly'
                        : 'yearly'}
                </span>
              </div>
              <div className="reports-trend">
                {data.trend.rows.map((r) => {
                  const total = parseFloat(r.total);
                  const pct = maxTrend > 0 ? (total / maxTrend) * 100 : 0;
                  return (
                    <div className="reports-trend-row" key={r.period}>
                      <span className="reports-trend-label">
                        {trendLabel(r.period, data.trend.granularity)}
                      </span>
                      <div className="reports-trend-track">
                        <div
                          className="reports-trend-bar"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <span className="reports-trend-total">
                        {data.currency} {total.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="reports-section">
            <div className="reports-section-head">
              <h2>
                {data.filters.waiter
                  ? `Products sold by ${data.filters.waiter.fullName}`
                  : 'Product sales'}
              </h2>
              <span className="muted">
                {term ? `${products.length} of ${data.byProduct.length}` : `${data.byProduct.length}`}
                {' '}product{data.byProduct.length === 1 ? '' : 's'}
              </span>
            </div>
            {!mine && !data.filters.product && (
              <p className="reports-hint">Tap a product to see which waiters sold it.</p>
            )}
            {products.length === 0 ? (
              <p className="muted">{term ? 'No products match your search.' : 'No products sold in this period.'}</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th className="num">Qty</th>
                      <th className="num">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const selected = productId === p.id;
                      return (
                        <tr
                          key={p.id}
                          className={`reports-row-clickable${selected ? ' selected' : ''}`}
                          onClick={() => toggleProduct(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleProduct(p.id);
                            }
                          }}
                          tabIndex={0}
                          aria-pressed={selected}
                          title={
                            mine
                              ? `Show only ${p.name}`
                              : `Show waiters who sold ${p.name}`
                          }
                        >
                          <td>{p.name}</td>
                          <td>{p.category ?? '—'}</td>
                          <td className="num">{p.qty_sold}</td>
                          <td className="num">{money(p.revenue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!mine && (
            <section className="reports-section">
              <div className="reports-section-head">
                <h2>
                  {data.filters.product
                    ? `Waiters who sold ${data.filters.product.name}`
                    : 'Waiter sales'}
                </h2>
                <span className="muted">
                  {term ? `${waiters.length} of ${data.byWaiter.length}` : `${data.byWaiter.length}`}
                  {' '}waiter{data.byWaiter.length === 1 ? '' : 's'}
                </span>
              </div>
              {!data.filters.waiter && (
                <p className="reports-hint">Tap a waiter to see everything they sold.</p>
              )}
              {waiters.length === 0 ? (
                <p className="muted">{term ? 'No waiters match your search.' : 'No waiter sales in this period.'}</p>
              ) : (
                <div className="reports-table-wrap">
                  <table className="reports-table">
                    <thead>
                      <tr>
                        <th>Waiter</th>
                        <th className="num">Orders</th>
                        <th className="num">Items</th>
                        <th className="num">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waiters.map((w) => {
                        const selected = waiterId === w.id;
                        return (
                          <tr
                            key={w.id}
                            className={`reports-row-clickable${selected ? ' selected' : ''}`}
                            onClick={() => toggleWaiter(w.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleWaiter(w.id);
                              }
                            }}
                            tabIndex={0}
                            aria-pressed={selected}
                            title={`Show what ${w.full_name} sold`}
                          >
                            <td>{w.full_name}</td>
                            <td className="num">{w.order_count}</td>
                            <td className="num">{w.item_count}</td>
                            <td className="num">{money(w.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
