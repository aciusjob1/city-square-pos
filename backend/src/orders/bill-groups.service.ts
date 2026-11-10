import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { buildConsolidatedReceiptTicket, ConsolidatedOrderSection } from '../printers/ticket.builders';
import { PrintTicketType } from '../printers/station.enum';
import { AuthUser } from './orders.service';

@Injectable()
export class BillGroupsService {
  private readonly logger = new Logger(BillGroupsService.name);

  constructor(private readonly db: DatabaseService) {}

  // ---------- MERGE ----------
  async merge(orderIds: string[], authUser: AuthUser) {
    if (!orderIds || orderIds.length < 2) {
      throw new BadRequestException({
        code: 'MERGE_REQUIRES_AT_LEAST_TWO_ORDERS',
        message: 'Select at least two orders to merge.',
      });
    }

    const orders = await this.db.query<{
      id: string;
      order_number: string;
      table_id: string | null;
      cancelled_at: string | null;
      closed_at: string | null;
      bill_group_id: string | null;
      waiter_id: string;
    }>(
      `SELECT id, order_number, table_id, cancelled_at, closed_at, bill_group_id, waiter_id
         FROM orders WHERE id = ANY($1::uuid[])`,
      [orderIds],
    );

    if (orders.rows.length !== orderIds.length) {
      throw new NotFoundException('One or more orders not found.');
    }

    for (const o of orders.rows) {
      if (o.cancelled_at) {
        throw new BadRequestException({
          code: 'CANNOT_MERGE_CANCELLED',
          message: `Order ${o.order_number} is cancelled.`,
        });
      }
      if (o.closed_at) {
        throw new BadRequestException({
          code: 'CANNOT_MERGE_CLOSED',
          message: `Order ${o.order_number} is already closed (bill printed).`,
        });
      }
      if (o.bill_group_id) {
        throw new BadRequestException({
          code: 'ALREADY_IN_BILL_GROUP',
          message: `Order ${o.order_number} is already part of a bill group.`,
        });
      }
    }

    // Waiters may only merge their own orders. Merging another waiter's
    // orders affects two people's sales, so that's a cashier/manager action.
    // This check is what lets us safely allow @Roles('WAITER', ...) on the
    // merge endpoint — the ownership boundary is enforced here, not at the
    // controller.
    if (authUser.role === 'WAITER') {
      for (const o of orders.rows) {
        if (o.waiter_id !== authUser.userId) {
          throw new ForbiddenException(
            'Waiters can only merge their own orders. Ask a cashier to merge across waiters.',
          );
        }
      }
    }

    // All orders must share the same table (or all takeaway)
    const tables = new Set(orders.rows.map((o) => o.table_id));
    if (tables.size > 1) {
      throw new BadRequestException({
        code: 'MERGE_TABLE_MISMATCH',
        message: 'All orders in a bill group must belong to the same table (or all be takeaway).',
      });
    }

    const billGroupId = (
      await this.db.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)
    ).rows[0].id;

    await this.db.query(
      `UPDATE orders SET bill_group_id = $1, updated_at = now() WHERE id = ANY($2::uuid[])`,
      [billGroupId, orderIds],
    );

    this.logger.log(
      `Merged ${orderIds.length} orders into bill group ${billGroupId} by ${authUser.username}`,
    );

    return {
      billGroupId,
      orderIds,
      orderCount: orderIds.length,
    };
  }

  // ---------- UNMERGE ----------
  async unmerge(billGroupId: string, authUser: AuthUser) {
    const orders = await this.db.query<{
      id: string;
      order_number: string;
      closed_at: string | null;
    }>(
      `SELECT id, order_number, closed_at FROM orders WHERE bill_group_id = $1`,
      [billGroupId],
    );
    if (orders.rows.length === 0) {
      throw new NotFoundException('Bill group not found.');
    }

    for (const o of orders.rows) {
      if (o.closed_at) {
        throw new BadRequestException({
          code: 'CANNOT_UNMERGE_AFTER_PRINT',
          message: `Order ${o.order_number} has been closed by a printed bill. Cannot unmerge.`,
        });
      }
    }

    await this.db.query(
      `UPDATE orders SET bill_group_id = NULL, updated_at = now() WHERE bill_group_id = $1`,
      [billGroupId],
    );

    this.logger.log(`Unmerged bill group ${billGroupId} by ${authUser.username}`);

    return { billGroupId, orderIds: orders.rows.map((o) => o.id), orderCount: orders.rows.length };
  }

  // ---------- CONSOLIDATED BILL ----------
  async printConsolidatedBill(billGroupId: string, authUser: AuthUser) {
    // Load orders with items + waiter name in one shot
    const ordersRes = await this.db.query<{
      id: string;
      order_number: string;
      table_id: string | null;
      table_name: string | null;
      order_type: string;
      currency: string;
      subtotal: string;
      closed_at: string | null;
      cancelled_at: string | null;
      waiter_full_name: string;
      created_at: string;
    }>(
      `SELECT o.id, o.order_number, o.table_id, t.name AS table_name,
              o.order_type, o.currency, o.subtotal,
              o.closed_at, o.cancelled_at,
              u.full_name AS waiter_full_name,
              o.server_created_at AS created_at
         FROM orders o
         JOIN users u ON u.id = o.waiter_id
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.bill_group_id = $1
        ORDER BY o.server_created_at ASC`,
      [billGroupId],
    );
    if (ordersRes.rows.length === 0) {
      throw new NotFoundException('Bill group not found.');
    }
    for (const o of ordersRes.rows) {
      if (o.cancelled_at) {
        throw new BadRequestException({
          code: 'BILL_GROUP_CONTAINS_CANCELLED',
          message: `Order ${o.order_number} is cancelled. Unmerge it before printing the bill.`,
        });
      }
      if (o.closed_at) {
        throw new BadRequestException({
          code: 'ALREADY_BILLED',
          message: `Order ${o.order_number} was already billed.`,
        });
      }
    }

    // Load items per order
    const itemsRes = await this.db.query<{
      order_id: string;
      product_name: string;
      quantity: number;
      unit_price: string;
      line_total: string;
      notes: string | null;
    }>(
      `SELECT oi.order_id, p.name AS product_name, oi.quantity,
              oi.unit_price, oi.line_total, oi.notes
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1::uuid[])
        ORDER BY oi.created_at ASC`,
      [ordersRes.rows.map((o) => o.id)],
    );

    // Group items by order
    const itemsByOrder = new Map<string, typeof itemsRes.rows>();
    for (const it of itemsRes.rows) {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id)!.push(it);
    }

    // Build sections + grand total
    const sections: ConsolidatedOrderSection[] = ordersRes.rows.map((o) => ({
      orderNumber: o.order_number,
      waiterFullName: o.waiter_full_name,
      createdAt: o.created_at,
      lines: (itemsByOrder.get(o.id) ?? []).map((it) => ({
        productName: it.product_name,
        quantity: it.quantity,
        unitPrice: parseFloat(it.unit_price),
        lineTotal: parseFloat(it.line_total),
        notes: it.notes,
      })),
      subtotal: parseFloat(o.subtotal),
    }));
    const grandTotal = +sections.reduce((s, x) => s + x.subtotal, 0).toFixed(2);
    const currency = ordersRes.rows[0].currency;
    const tableName = ordersRes.rows[0].table_name;
    const orderType = ordersRes.rows[0].order_type;

    // Receipt printer
    const printer = await this.db.query<{ id: string }>(
      `SELECT id FROM printers WHERE is_active = true AND station = 'NONE'
        ORDER BY created_at ASC LIMIT 1`,
    );
    if (!printer.rows[0]) {
      throw new ConflictException({
        code: 'NO_RECEIPT_PRINTER',
        message: 'No receipt printer is configured.',
      });
    }

    const payload = buildConsolidatedReceiptTicket({
      orders: sections,
      tableName,
      orderType,
      currency,
      grandTotal,
      printedAt: new Date().toISOString(),
    });

    // Insert RECEIPT job (linked to the first order for schema compatibility;
    // the payload itself contains all order numbers) + close all orders.
    const printJobId = await this.db.transaction(async (client: PoolClient) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status, idempotency_key)
         VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING', $5)
         RETURNING id`,
        [
          ordersRes.rows[0].id,
          printer.rows[0].id,
          PrintTicketType.RECEIPT,
          payload,
          `billgroup-${billGroupId}`,
        ],
      );

      await client.query(
        `UPDATE orders SET closed_at = COALESCE(closed_at, now()), updated_at = now()
          WHERE bill_group_id = $1`,
        [billGroupId],
      );

      return inserted.rows[0].id;
    });

    this.logger.log(
      `Consolidated bill ${printJobId} for group ${billGroupId} ` +
      `(${sections.length} orders, TZS ${grandTotal}) by ${authUser.username}`,
    );

    return {
      printJobId,
      billGroupId,
      orderCount: sections.length,
      grandTotal: grandTotal.toFixed(2),
      currency,
    };
  }

  // ---------- FETCH ----------
  async getBillGroup(billGroupId: string, authUser?: AuthUser) {
    const ordersRes = await this.db.query(
      `SELECT o.id, o.order_number, o.status, o.subtotal, o.total_amount, o.currency,
              o.closed_at, o.cancelled_at, o.bill_group_id,
              u.username AS waiter_username, u.full_name AS waiter_full_name,
              t.name AS table_name
         FROM orders o
         JOIN users u ON u.id = o.waiter_id
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.bill_group_id = $1
        ORDER BY o.server_created_at ASC`,
      [billGroupId],
    );
    if (ordersRes.rows.length === 0) {
      throw new NotFoundException('Bill group not found.');
    }
    // Waiters can only view groups where every order belongs to them.
    if (authUser && authUser.role === 'WAITER') {
      for (const o of ordersRes.rows) {
        if (o.waiter_username) {
          // If we have the username in the row, verify against authUser
          // This is only a safety net; controller will pass authUser for waiter callers
        }
      }
      // Safer: fetch waiter_id per order and compare
      const checkRes = await this.db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM orders
           WHERE bill_group_id = $1 AND waiter_id != $2`,
        [billGroupId, authUser.userId],
      );
      if (parseInt(checkRes.rows[0].n, 10) > 0) {
        throw new ForbiddenException('You can only view your own bill groups.');
      }
    }
    const grandTotal = ordersRes.rows.reduce(
      (s, o) => s + parseFloat(o.total_amount),
      0,
    );
    return {
      billGroupId,
      orderCount: ordersRes.rows.length,
      grandTotal: grandTotal.toFixed(2),
      currency: ordersRes.rows[0].currency,
      orders: ordersRes.rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        subtotal: o.subtotal,
        totalAmount: o.total_amount,
        closedAt: o.closed_at,
        cancelledAt: o.cancelled_at,
        waiter: { username: o.waiter_username, fullName: o.waiter_full_name },
        tableName: o.table_name,
      })),
    };
  }
}
