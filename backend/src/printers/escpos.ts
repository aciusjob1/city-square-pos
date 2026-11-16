/**
 * ESC/POS renderer for City Square tickets.
 *
 * The database stores tickets as JSON (see ticket.builders.ts) so the payload
 * stays inspectable. A thermal printer needs raw ESC/POS bytes, so this module
 * turns any stored ticket payload into a 80mm (48 column) print image.
 */

const COLUMNS = 48;
const TZ = 'Africa/Dar_es_Salaam';

const ESC = 0x1b;
const GS = 0x1d;

class EscPos {
  private parts: Buffer[] = [];

  raw(...bytes: number[]) {
    this.parts.push(Buffer.from(bytes));
    return this;
  }

  init() {
    // Initialize, then select PC437 (safe default on 80mm units).
    return this.raw(ESC, 0x40).raw(ESC, 0x74, 0x00);
  }

  align(mode: 0 | 1 | 2) {
    return this.raw(ESC, 0x61, mode);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  doubleSize(on: boolean) {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  text(value: string) {
    this.parts.push(Buffer.from(sanitize(value), 'latin1'));
    return this;
  }

  line(value = '') {
    return this.text(value + '\n');
  }

  cut() {
    // Feed a little, then partial cut when the unit has a cutter.
    return this.text('\n\n\n').raw(GS, 0x56, 0x42, 0x00);
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** Keep bytes inside CP437/Latin-1 range so no printer emulation garbles them. */
function sanitize(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u00a0/g, ' ');
}

function formatWhen(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function padRow(left: string, right: string, width = COLUMNS): string {
  const room = width - right.length - 1;
  const head = left.length > room ? left.slice(0, Math.max(0, room - 1)) + '~' : left;
  const gap = Math.max(1, width - head.length - right.length);
  return head + ' '.repeat(gap) + right;
}

function wrap(value: string, width = COLUMNS, indent = ''): string[] {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = indent;
  for (const word of words) {
    const candidate = current.trim() === '' ? current + word : current + ' ' + word;
    if (candidate.length > width && current.trim() !== '') {
      lines.push(current);
      current = ' '.repeat(indent.length) + word;
    } else {
      current = candidate;
    }
  }
  if (current.trim() !== '') lines.push(current);
  return lines;
}

function rule(char = '-'): string {
  return char.repeat(COLUMNS);
}

function prettyOrderType(value: unknown): string {
  return String(value ?? '').replace(/_/g, ' ');
}

interface StoredLine {
  productName: string;
  quantity: number;
  notes?: string | null;
  unitPrice?: number;
  lineTotal?: number;
}

function renderPreparation(ticket: any): Buffer {
  const b = new EscPos().init();
  b.align(1).bold(true).doubleSize(true);
  b.line(String(ticket?.header?.restaurantName ?? 'CITY SQUARE'));
  b.doubleSize(false).line(String(ticket?.header?.station ?? '') + ' ORDER').bold(false);
  b.align(0).line(rule('='));
  b.line(`Order : ${ticket?.header?.orderNumber ?? ''}`);
  b.line(`Table : ${ticket?.context?.table ?? '-'}`);
  b.line(`Waiter: ${ticket?.context?.waiter ?? ''}`);
  b.line(`Type  : ${prettyOrderType(ticket?.context?.orderType)}`);
  b.line(`Time  : ${formatWhen(ticket?.header?.createdAt)}`);
  b.line(rule());

  const lines: StoredLine[] = Array.isArray(ticket?.lines) ? ticket.lines : [];
  for (const line of lines) {
    b.bold(true).line(`${line.quantity} x ${String(line.productName ?? '')}`).bold(false);
    for (const note of wrap(line.notes ?? '', COLUMNS, '    ')) b.line(note);
  }

  b.line(rule());
  if (ticket?.context?.notes) {
    b.line('Order note:');
    for (const note of wrap(ticket.context.notes, COLUMNS, '  ')) b.line(note);
    b.line(rule());
  }
  b.align(1).line(`Printed ${formatWhen(new Date().toISOString())}`);
  b.cut();
  return b.build();
}

function renderPricedLines(b: EscPos, lines: StoredLine[]) {
  for (const line of lines) {
    const amount = money(line.lineTotal ?? Number(line.unitPrice ?? 0) * Number(line.quantity ?? 0));
    b.line(padRow(`${line.quantity} x ${String(line.productName ?? '')}`, amount));
    for (const note of wrap(line.notes ?? '', COLUMNS, '    ')) b.line(note);
  }
}

function renderReceipt(ticket: any): Buffer {
  const b = new EscPos().init();
  b.align(1).bold(true).doubleSize(true);
  b.line(String(ticket?.header?.restaurantName ?? 'CITY SQUARE'));
  b.doubleSize(false).line('RECEIPT').bold(false);
  b.align(0).line(rule('='));
  b.line(`Order : ${ticket?.header?.orderNumber ?? ''}`);
  b.line(`Table : ${ticket?.context?.table ?? '-'}`);
  b.line(`Waiter: ${ticket?.context?.waiter ?? ''}`);
  b.line(`Type  : ${prettyOrderType(ticket?.context?.orderType)}`);
  b.line(`Time  : ${formatWhen(ticket?.header?.createdAt)}`);
  b.line(rule());

  renderPricedLines(b, Array.isArray(ticket?.lines) ? ticket.lines : []);

  b.line(rule());
  const totals = ticket?.totals ?? {};
  b.line(padRow('Subtotal', money(totals.subtotal)));
  if (Number(totals.discountAmount) > 0) b.line(padRow('Discount', '-' + money(totals.discountAmount)));
  b.bold(true).line(padRow('TOTAL', `${money(totals.totalAmount)} ${totals.currency ?? ''}`.trim())).bold(false);
  b.line(rule('='));
  b.align(1).line(String(ticket?.footer?.message ?? 'Thank you - Karibu tena'));
  b.line(`Printed ${formatWhen(new Date().toISOString())}`);
  b.cut();
  return b.build();
}

function renderConsolidated(ticket: any): Buffer {
  const b = new EscPos().init();
  b.align(1).bold(true).doubleSize(true);
  b.line(String(ticket?.header?.restaurantName ?? 'CITY SQUARE'));
  b.doubleSize(false).line('CONSOLIDATED BILL').bold(false);
  b.align(0).line(rule('='));
  b.line(`Table : ${ticket?.header?.table ?? '-'}`);
  b.line(`Type  : ${prettyOrderType(ticket?.header?.orderType)}`);
  b.line(`Orders: ${ticket?.header?.orderCount ?? ''}`);
  b.line(rule());

  const sections: any[] = Array.isArray(ticket?.sections) ? ticket.sections : [];
  for (const section of sections) {
    b.bold(true).line(`#${section.orderNumber ?? ''}`).bold(false);
    b.line(`Waiter: ${section.waiter ?? ''}   ${formatWhen(section.createdAt)}`);
    renderPricedLines(b, Array.isArray(section.lines) ? section.lines : []);
    b.line(padRow('Order subtotal', money(section.subtotal)));
    b.line(rule());
  }

  const totals = ticket?.totals ?? {};
  b.bold(true).doubleSize(true);
  b.line(padRow('GRAND TOTAL', money(totals.grandTotal)));
  b.doubleSize(false).bold(false);
  b.line(`Currency: ${totals.currency ?? ''}`);
  b.line(rule('='));
  b.align(1).line(String(ticket?.footer?.message ?? 'Thank you - Karibu tena'));
  b.line(`Printed ${formatWhen(new Date().toISOString())}`);
  b.cut();
  return b.build();
}

/** Last resort for payloads from a future format: print them as wrapped text. */
function renderPlain(payload: string): Buffer {
  const b = new EscPos().init();
  for (const line of wrap(payload, COLUMNS)) b.line(line);
  b.cut();
  return b.build();
}

export function renderTicket(payload: string): Buffer {
  let ticket: any;
  try {
    ticket = JSON.parse(payload);
  } catch {
    return renderPlain(payload);
  }
  if (!ticket || typeof ticket !== 'object') return renderPlain(payload);
  if (ticket.kind === 'RECEIPT') {
    return ticket.consolidated ? renderConsolidated(ticket) : renderReceipt(ticket);
  }
  if (ticket.kind === 'PREPARATION') return renderPreparation(ticket);
  return renderPlain(payload);
}

/** Self-check ticket used by the "Test print" button in Settings. */
export function buildTestTicketPayload(restaurantName: string, printerName: string): string {
  return JSON.stringify({
    format: 'CITY_SQUARE_TICKET_V1',
    kind: 'PREPARATION',
    station: 'TEST PRINT',
    header: {
      restaurantName,
      station: 'TEST PRINT',
      orderNumber: 'TEST',
      createdAt: new Date().toISOString(),
    },
    context: {
      waiter: 'Manager',
      table: '-',
      orderType: 'SYSTEM CHECK',
      notes: `Printer: ${printerName}`,
    },
    lines: [
      { productName: 'Thermal printer connection OK', quantity: 1, notes: null },
      { productName: 'Kitchen / bar / receipt routing active', quantity: 1, notes: null },
    ],
    footer: { generatedAt: new Date().toISOString() },
  });
}
