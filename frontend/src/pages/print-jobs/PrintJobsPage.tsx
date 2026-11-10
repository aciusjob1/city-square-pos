import { useEffect, useState } from 'react';
import { listPrintJobs } from '../../lib/waiter.api';
import type { PrintJobFull } from '../../lib/waiter.api';

type Filter = 'ALL' | 'KITCHEN' | 'BAR' | 'RECEIPT';

interface ParsedLine {
  productName: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  notes?: string | null;
}

interface ParsedTicket {
  format: string;
  kind: 'PREPARATION' | 'RECEIPT';
  station?: string;
  consolidated?: boolean;
  header: {
    restaurantName: string;
    station?: string;
    orderNumber?: string;
    table?: string | null;
    orderType?: string;
    orderCount?: number;
    createdAt?: string;
  };
  context?: {
    waiter?: string;
    table?: string | null;
    orderType?: string;
    notes?: string | null;
  };
  // Single-order receipts and prep tickets use `lines`
  lines?: ParsedLine[];
  // Consolidated receipts use `sections`
  sections?: Array<{
    orderNumber: string;
    waiter: string;
    createdAt: string;
    lines: ParsedLine[];
    subtotal: number;
  }>;
  totals?: {
    subtotal?: number;
    discountAmount?: number;
    totalAmount?: number;
    grandTotal?: number;
    currency: string;
  };
  footer?: { generatedAt: string; message?: string };
}

function parsePayload(raw: string): ParsedTicket | null {
  try { return JSON.parse(raw) as ParsedTicket; } catch { return null; }
}

function fmtCurrency(n: number, currency: string) {
  return `${currency} ${Math.round(n).toLocaleString()}`;
}

function TicketLineRow({ line, currency }: { line: ParsedLine; currency: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>
        {line.quantity}× {line.productName}
        {line.notes && (
          <span style={{ display: 'block', fontSize: 11, color: '#555' }}>
            » {line.notes}
          </span>
        )}
      </span>
      {line.lineTotal !== undefined && (
        <span style={{ whiteSpace: 'nowrap' }}>
          {fmtCurrency(line.lineTotal, currency)}
        </span>
      )}
    </div>
  );
}

function ThermalTicket({ job }: { job: PrintJobFull }) {
  const t = parsePayload(job.payload);
  if (!t) {
    return (
      <pre className="thermal-paper">
        Could not parse payload: {job.payload.slice(0, 200)}
      </pre>
    );
  }

  // -------- Consolidated receipt (multiple orders in one bill) --------
  if (t.consolidated && t.sections) {
    const currency = t.totals?.currency ?? 'TZS';
    return (
      <div className="thermal-paper">
        <div style={{ textAlign: 'center', fontWeight: 700 }}>
          {t.header.restaurantName}
        </div>
        <div style={{ textAlign: 'center', letterSpacing: 2, marginBottom: 6, fontWeight: 600 }}>
          BILL · CONSOLIDATED
        </div>
        {t.header.table && (
          <div style={{ textAlign: 'center', marginBottom: 6 }}>Table: {t.header.table}</div>
        )}
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />

        {t.sections.map((sec, idx) => (
          <div key={idx} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {sec.orderNumber}
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>
              Waiter: {sec.waiter}
            </div>
            {sec.lines.map((l, i) => (
              <TicketLineRow key={i} line={l} currency={currency} />
            ))}
            <div style={{
              borderTop: '1px dotted #bbb',
              margin: '4px 0',
              paddingTop: 4,
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 600,
              fontSize: 12,
            }}>
              <span>Subtotal</span>
              <span>{fmtCurrency(sec.subtotal, currency)}</span>
            </div>
          </div>
        ))}

        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}>
          <span>GRAND TOTAL</span>
          <span>{fmtCurrency(t.totals?.grandTotal ?? 0, currency)}</span>
        </div>
        <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
        {t.footer?.message && (
          <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
            {t.footer.message}
          </div>
        )}
      </div>
    );
  }

  // -------- Single-order receipt or prep ticket --------
  const lines = t.lines ?? [];
  const currency = t.totals?.currency ?? 'TZS';

  return (
    <div className="thermal-paper">
      <div style={{ textAlign: 'center', fontWeight: 700 }}>
        {t.header.restaurantName}
      </div>
      <div style={{ textAlign: 'center', letterSpacing: 2, marginBottom: 6, fontWeight: 600 }}>
        {t.kind === 'RECEIPT' ? 'BILL' : (t.station || '').toUpperCase()}
      </div>
      <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
      {t.header.orderNumber && <div>Order: <strong>{t.header.orderNumber}</strong></div>}
      {t.context?.waiter && <div>Waiter: {t.context.waiter}</div>}
      {t.context?.table && <div>Table: {t.context.table}</div>}
      {t.context?.orderType === 'TAKEAWAY' && <div>Type: TAKEAWAY</div>}
      <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />

      {lines.map((l, i) => (
        <TicketLineRow key={i} line={l} currency={currency} />
      ))}

      {t.totals && (
        <>
          <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
          {t.totals.subtotal !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span>{fmtCurrency(t.totals.subtotal, currency)}</span>
            </div>
          )}
          {(t.totals.discountAmount ?? 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Discount</span>
              <span>-{fmtCurrency(t.totals.discountAmount!, currency)}</span>
            </div>
          )}
          {t.totals.totalAmount !== undefined && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontWeight: 700, fontSize: 15, marginTop: 4,
            }}>
              <span>TOTAL</span>
              <span>{fmtCurrency(t.totals.totalAmount, currency)}</span>
            </div>
          )}
        </>
      )}

      <div style={{ borderTop: '1px dashed #999', margin: '8px 0' }} />
      {t.header.createdAt && (
        <div style={{ textAlign: 'center', fontSize: 11 }}>
          {new Date(t.header.createdAt).toLocaleString()}
        </div>
      )}
      {t.footer?.message && (
        <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
          {t.footer.message}
        </div>
      )}
    </div>
  );
}

export function PrintJobsPage() {
  const [jobs, setJobs] = useState<PrintJobFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = async () => {
    setError(null);
    const r = await listPrintJobs({
      station: filter === 'ALL' ? undefined : filter,
      limit: 200,
    });
    if (r.ok && r.data) setJobs(r.data.printJobs);
    else setError(r.errorMessage ?? 'Failed to load print jobs');
  };

  useEffect(() => { load(); }, [filter]);

  return (
    <div className="page">
      <h1>Print Jobs</h1>
      <p className="subtitle">
        Every ticket the kitchen, bar, and receipt printers will receive.
      </p>

      <div className="category-tabs">
        {(['ALL', 'KITCHEN', 'BAR', 'RECEIPT'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`category-tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
        <button className="category-tab" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}
      {!jobs && !error && <p className="muted" style={{ marginTop: 24 }}>Loading…</p>}
      {jobs && jobs.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>No print jobs found.</p>
      )}

      {jobs && jobs.length > 0 && (
        <div className="print-jobs-grid">
          {jobs.map((j) => (
            <div key={j.id} className="print-job-wrapper">
              <div className="print-job-header">
                <span>
                  <strong>{j.ticket_type}</strong>
                  {' · '}
                  {j.status}
                  {j.idempotency_key && j.idempotency_key.startsWith('bill-reprint') && (
                    <span className="reprint-badge">REPRINT</span>
                  )}
                  {j.idempotency_key && j.idempotency_key.startsWith('billgroup-') && (
                    <span className="reprint-badge" style={{ background: '#dbeafe', color: '#1e40af' }}>
                      CONSOLIDATED
                    </span>
                  )}
                  {' · '}
                  {j.order_number}
                  {j.table_name && ` · ${j.table_name}`}
                </span>
                <span>{new Date(j.created_at).toLocaleString()}</span>
              </div>
              <ThermalTicket job={j} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
