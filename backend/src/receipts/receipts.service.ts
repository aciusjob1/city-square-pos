import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { PrintersService } from '../printers/printers.service';
import { buildReceiptTicket, PricedTicketLine } from '../printers/ticket.builders';
import { PrintTicketType, Station } from '../printers/station.enum';
import { AuthUser } from '../orders/orders.service';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly printers: PrintersService,
  ) {}

  /**
   * Create a RECEIPT print job for an order.
   * IMPORTANT: this does NOT change the order in any way.
   * It only adds a print_jobs row and returns the bill payload.
   */
  async requestBill(orderId: string, clientUuid: string, authUser: AuthUser) {
    // 1) Sequential idempotency: if we already made a RECEIPT job with this
    //    clientUuid, return it verbatim without re-printing.
    const existing = await this.db.query<{ order_id: string }>(
      `SELECT order_id FROM print_jobs
        WHERE payload LIKE $1 AND ticket_type = 'RECEIPT'
        LIMIT 1`,
      [`%"clientUuid":"${clientUuid}"%`],
    );
    if (existing.rows[0]) {
      return this.buildResponseForExistingJob(existing.rows[0].order_id);
    }

    // 2) Load the order + lines to build the receipt
    const ordRes = await this.db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal,
              o.discount_amount, o.total_amount, o.currency, o.notes,
              o.cancelled_at,
              u.full_name AS waiter_full_name,
              t.name AS table_name
         FROM orders o
         JOIN users u ON u.id = o.waiter_id
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.id = $1`,
      [orderId],
    );
    if (!ordRes.rows[0]) throw new NotFoundException('Order not found');
    const o = ordRes.rows[0];
    if (o.cancelled_at) {
      throw new BadRequestException({
        code: 'ORDER_CANCELLED',
        message: 'Cannot request a bill for a cancelled order.',
      });
    }

    const itemsRes = await this.db.query(
      `SELECT p.name AS product_name, oi.quantity, oi.unit_price, oi.line_total, oi.notes
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC`,
      [orderId],
    );
    const lines: PricedTicketLine[] = itemsRes.rows.map((r) => ({
      productName: r.product_name,
      quantity: r.quantity,
      unitPrice: parseFloat(r.unit_price),
      lineTotal: parseFloat(r.line_total),
      notes: r.notes,
    }));

    // 3) Locate the receipt printer (must exist per migration 002)
    const printer = await this.db.query<{ id: string }>(
      `SELECT id FROM printers
        WHERE is_active = true AND station = 'NONE'
        ORDER BY created_at ASC
        LIMIT 1`,
    );
    if (!printer.rows[0]) {
      throw new ConflictException({
        code: 'NO_RECEIPT_PRINTER',
        message: 'No receipt printer is configured.',
      });
    }

    // 4) Build payload and insert print job. Everything in one transaction
    //    so we never leave a half-written bill.
    const payload = buildReceiptTicket({
      orderNumber: o.order_number,
      waiterFullName: o.waiter_full_name,
      tableName: o.table_name,
      orderType: o.order_type,
      orderNotes: o.notes,
      createdAt: new Date().toISOString(),
      currency: o.currency,
      subtotal: parseFloat(o.subtotal),
      discountAmount: parseFloat(o.discount_amount),
      totalAmount: parseFloat(o.total_amount),
      lines,
    });

    // Attach the clientUuid into the payload so the idempotency lookup above
    // can find it next time. This is internal metadata, not shown to the guest.
    const payloadWithMeta = (() => {
      const parsed = JSON.parse(payload);
      parsed.clientUuid = clientUuid;
      return JSON.stringify(parsed);
    })();

    const inserted = await this.db.transaction(async (client: PoolClient) => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status)
         VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING')
         RETURNING id`,
        [orderId, printer.rows[0].id, PrintTicketType.RECEIPT, payloadWithMeta],
      );
      return r.rows[0].id;
    });

    this.logger.log(
      `Receipt job ${inserted} for ${o.order_number} requested by ${authUser.username}`,
    );

    return {
      printJobId: inserted,
      orderId,
      orderNumber: o.order_number,
      bill: JSON.parse(payloadWithMeta),
    };
  }

  private async buildResponseForExistingJob(orderId: string) {
    const r = await this.db.query(
      `SELECT id, payload FROM print_jobs
        WHERE order_id = $1 AND ticket_type = 'RECEIPT'
        ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (!r.rows[0]) throw new NotFoundException('No existing receipt found');
    return {
      printJobId: r.rows[0].id,
      orderId,
      orderNumber: JSON.parse(r.rows[0].payload).header?.orderNumber,
      bill: JSON.parse(r.rows[0].payload),
    };
  }
}
