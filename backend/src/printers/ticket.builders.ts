import { Station } from './station.enum';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface TicketLine {
  productName: string;
  quantity: number;
  notes: string | null;
}

export interface PricedTicketLine extends TicketLine {
  unitPrice: number;
  lineTotal: number;
}

export interface TicketContext {
  orderNumber: string;
  waiterFullName: string;
  tableName: string | null;
  orderType: string;
  orderNotes: string | null;
  createdAt: string; // ISO string; already in Africa/Dar_es_Salaam display form
}

// ---------------------------------------------------------------------------
// 1) Kitchen / Bar ticket — NO PRICES. Enforced by type.
// ---------------------------------------------------------------------------

export interface BuildKitchenBarInput extends TicketContext {
  station: Station;
  lines: TicketLine[]; // deliberately has no price fields
}

export function buildKitchenBarTicket(input: BuildKitchenBarInput): string {
  const ticket = {
    format: 'CITY_SQUARE_TICKET_V1',
    kind: 'PREPARATION',
    station: input.station,
    header: {
      restaurantName: 'City Square Restaurant',
      station: input.station,
      orderNumber: input.orderNumber,
      createdAt: input.createdAt,
    },
    context: {
      waiter: input.waiterFullName,
      table: input.tableName,
      orderType: input.orderType,
      notes: input.orderNotes,
    },
    lines: input.lines.map((l) => ({
      productName: l.productName,
      quantity: l.quantity,
      notes: l.notes,
    })),
    footer: {
      generatedAt: new Date().toISOString(),
    },
  };
  return JSON.stringify(ticket);
}

// ---------------------------------------------------------------------------
// 2) Receipt / Bill ticket — full prices. Never sent to KITCHEN or BAR stations.
// ---------------------------------------------------------------------------

export interface BuildReceiptInput extends TicketContext {
  currency: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  lines: PricedTicketLine[];
}

export function buildReceiptTicket(input: BuildReceiptInput): string {
  const ticket = {
    format: 'CITY_SQUARE_RECEIPT_V1',
    kind: 'RECEIPT',
    header: {
      restaurantName: 'City Square Restaurant',
      orderNumber: input.orderNumber,
      createdAt: input.createdAt,
    },
    context: {
      waiter: input.waiterFullName,
      table: input.tableName,
      orderType: input.orderType,
    },
    lines: input.lines.map((l) => ({
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      notes: l.notes,
    })),
    totals: {
      subtotal: input.subtotal,
      discountAmount: input.discountAmount,
      totalAmount: input.totalAmount,
      currency: input.currency,
    },
    footer: {
      generatedAt: new Date().toISOString(),
      message: 'Thank you — Karibu tena',
    },
  };
  return JSON.stringify(ticket);
}
