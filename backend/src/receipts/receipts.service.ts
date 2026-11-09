import {
  BadRequestException, ConflictException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { buildReceiptTicket, PricedTicketLine } from '../printers/ticket.builders';
import { PrintTicketType } from '../printers/station.enum';
import { AuthUser } from '../orders/orders.service';

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(private readonly db: DatabaseService) {}

  async requestBill(orderId: string, authUser: AuthUser) {
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

    // Return a still-PENDING bill for this order (idempotent first print).
    const existingPending = await this.db.query<{ id: string; payload: string }>(
      `SELECT id, payload FROM print_jobs
        WHERE order_id = $1
          AND ticket_type = 'RECEIPT'
          AND status = 'PENDING'
          AND idempotency_key LIKE 'bill-%'
        ORDER BY created_at ASC
        LIMIT 1`,
      [orderId],
    );
    if (existingPending.rows[0]) {
      return {
        printJobId: existingPending.rows[0].id,
        orderId,
        orderNumber: o.order_number,
        bill: JSON.parse(existingPending.rows[0].payload),
        reprint: false,
      };
    }

    const confirmedCount = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM print_jobs
        WHERE order_id = $1
          AND ticket_type = 'RECEIPT'
          AND status IN ('SENT', 'CONFIRMED')`,
      [orderId],
    );
    const priorPrints = parseInt(confirmedCount.rows[0].n, 10);
    const idempotencyKey = priorPrints === 0
      ? `bill-${orderId}`
      : `bill-reprint-${orderId}-${priorPrints + 1}`;

    const printer = await this.db.query<{ id: string }>(
      `SELECT id FROM printers
        WHERE is_active = true AND station = 'NONE'
        ORDER BY created_at ASC LIMIT 1`,
    );
    if (!printer.rows[0]) {
      throw new ConflictException({
        code: 'NO_RECEIPT_PRINTER',
        message: 'No receipt printer is configured.',
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

    try {
      const printJobId = await this.db.transaction(async (client: PoolClient) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status, idempotency_key)
           VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING', $5)
           RETURNING id`,
          [orderId, printer.rows[0].id, PrintTicketType.RECEIPT, payload, idempotencyKey],
        );
        await client.query(
          `UPDATE orders SET closed_at = COALESCE(closed_at, now()) WHERE id = $1`,
          [orderId],
        );
        return inserted.rows[0].id;
      });

      this.logger.log(
        `Bill job ${printJobId} (${idempotencyKey}) for ${o.order_number} by ${authUser.username}`,
      );

      return {
        printJobId,
        orderId,
        orderNumber: o.order_number,
        bill: JSON.parse(payload),
        reprint: priorPrints > 0,
      };
    } catch (err: any) {
      if (
        err?.code === '23505' &&
        String(err.constraint || '').includes('print_jobs_idempotency_key')
      ) {
        const dup = await this.db.query<{ id: string; payload: string }>(
          `SELECT id, payload FROM print_jobs
            WHERE order_id = $1 AND ticket_type = 'RECEIPT'
            ORDER BY created_at ASC LIMIT 1`,
          [orderId],
        );
        if (dup.rows[0]) {
          return {
            printJobId: dup.rows[0].id,
            orderId,
            orderNumber: o.order_number,
            bill: JSON.parse(dup.rows[0].payload),
            reprint: false,
          };
        }
      }
      throw err;
    }
  }
}
