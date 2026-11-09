import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AppendItemsDto } from './dto/append-items.dto';
import { allocateOrderNumber } from '../common/utils/order-number';
import { buildKitchenBarTicket } from '../printers/ticket.builders';
import { PrintersService } from '../printers/printers.service';
import { PrintTicketType, Station } from '../printers/station.enum';

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

interface ProductRow {
  id: string;
  name: string;
  selling_price: string;
  preparation_station: string;
  is_active: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly printers: PrintersService,
  ) {}

  async create(dto: CreateOrderDto, authUser: AuthUser) {
    // -------- Idempotency fast path (sequential retries) --------
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE client_uuid = $1 LIMIT 1`,
      [dto.clientUuid],
    );
    if (existing.rows[0]) {
      return this.fetchFullOrder(existing.rows[0].id);
    }

    // -------- Validate all products before opening a tx --------
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const productRes = await this.db.query<ProductRow>(
      `SELECT id, name, selling_price, preparation_station, is_active
         FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const productRows = productRes.rows as ProductRow[];
    const productMap: Map<string, ProductRow> = new Map(
      productRows.map((p) => [p.id, p]),
    );

    const invalidItems: { productId: string; reason: string }[] = [];
    for (const item of dto.items) {
      const p = productMap.get(item.productId);
      if (!p) invalidItems.push({ productId: item.productId, reason: 'NOT_FOUND' });
      else if (!p.is_active) invalidItems.push({ productId: item.productId, reason: 'INACTIVE' });
    }
    if (invalidItems.length > 0) {
      throw new BadRequestException({
        message: 'One or more products are invalid. Order was not created.',
        invalidItems,
      });
    }

    // -------- Main transaction --------
    try {
      const orderId = await this.db.transaction(async (client) => {
        const orderNumber = await allocateOrderNumber(client);

        // Build order_items with server-authoritative prices and station snapshots
        const lines = dto.items.map((it) => {
          const p = productMap.get(it.productId)!;
          const unit = parseFloat(p.selling_price);
          return {
            productId: p.id,
            productName: p.name,
            quantity: it.quantity,
            unitPrice: unit,
            lineTotal: +(unit * it.quantity).toFixed(2),
            station: p.preparation_station as Station,
            notes: it.notes ?? null,
          };
        });
        const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);

        const orderInsert = await client.query<{ id: string }>(
          `INSERT INTO orders
             (order_number, waiter_id, table_id, order_type, status,
              subtotal, discount_amount, total_amount, paid_amount,
              currency, notes, device_id, client_uuid, sync_status,
              client_created_at)
           VALUES
             ($1, $2, $3, $4::"OrderType", 'SENT_TO_KITCHEN',
              $5, 0, $5, 0,
              'TZS', $6, $7, $8, 'SYNCED',
              now())
           RETURNING id`,
          [
            orderNumber,
            authUser.userId,
            dto.tableId ?? null,
            dto.orderType,
            subtotal,
            dto.notes ?? null,
            dto.deviceId ?? null,
            dto.clientUuid,
          ],
        );
        const newOrderId = orderInsert.rows[0].id;

        for (const l of lines) {
          await client.query(
            `INSERT INTO order_items
               (order_id, product_id, quantity, unit_price, line_total, station, notes)
             VALUES ($1, $2, $3, $4, $5, $6::"Station", $7)`,
            [newOrderId, l.productId, l.quantity, l.unitPrice, l.lineTotal, l.station, l.notes],
          );
        }

        // Group by station → one print job per station
        const byStation = new Map<Station, typeof lines>();
        for (const l of lines) {
          if (!byStation.has(l.station)) byStation.set(l.station, []);
          byStation.get(l.station)!.push(l);
        }

        // Look up waiter + table for ticket context
        const ctx = await client.query<{ waiter_name: string; table_name: string | null }>(
          `SELECT u.full_name AS waiter_name, t.name AS table_name
             FROM users u
             LEFT JOIN tables t ON t.id = $2
            WHERE u.id = $1`,
          [authUser.userId, dto.tableId ?? null],
        );
        const waiterFullName = ctx.rows[0]?.waiter_name ?? authUser.username;
        const tableName = ctx.rows[0]?.table_name ?? null;

        for (const [station, stationLines] of byStation.entries()) {
          if (station === Station.NONE) continue;
          const printer = await this.printers.findPrinterForStation(client, station);
          if (!printer) {
            this.logger.warn(`No active printer for station ${station}; skipping print job`);
            continue;
          }
          const payload = buildKitchenBarTicket({
            orderNumber,
            station,
            waiterFullName,
            tableName,
            orderType: dto.orderType,
            orderNotes: dto.notes ?? null,
            createdAt: new Date().toISOString(),
            lines: stationLines.map((l) => ({
              productName: l.productName,
              quantity: l.quantity,
              notes: l.notes,
            })),
          });
          const ticketType =
            station === Station.KITCHEN ? PrintTicketType.KITCHEN : PrintTicketType.BAR;
          await client.query(
            `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status)
             VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING')`,
            [newOrderId, printer.id, ticketType, payload],
          );
        }

        return newOrderId;
      });

      return this.fetchFullOrder(orderId);
    } catch (err: any) {
      // 23505 = unique_violation — happens when two concurrent requests
      // carry the same client_uuid. The other one won; return its order.
      // (a) Concurrent retry with the same clientUuid — return the winner.
      if (err?.code === '23505' && String(err.detail || '').includes('client_uuid')) {
        const dup = await this.db.query<{ id: string }>(
          `SELECT id FROM orders WHERE client_uuid = $1 LIMIT 1`,
          [dto.clientUuid],
        );
        if (dup.rows[0]) return this.fetchFullOrder(dup.rows[0].id);
      }
      // (b) Concurrent creation for a table that already has an active order —
      //     the DB partial unique index refused a second active row. Return
      //     the existing active order so the client behaves as if it "resumed".
      if (
        err?.code === '23505' &&
        String(err.constraint || '').includes('orders_one_active_per_table') &&
        dto.tableId
      ) {
        const existing = await this.db.query<{ id: string }>(
          `SELECT id FROM orders WHERE table_id = $1 AND cancelled_at IS NULL LIMIT 1`,
          [dto.tableId],
        );
        if (existing.rows[0]) return this.fetchFullOrder(existing.rows[0].id);
      }
      throw err;
    }
  }

  async fetchFullOrder(orderId: string) {
    const order = await this.db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal,
              o.discount_amount, o.total_amount, o.paid_amount, o.currency,
              o.notes, o.client_uuid, o.sync_status,
              o.client_created_at, o.server_created_at,
              o.cancelled_at, o.cancellation_reason,
              u.id AS waiter_id, u.username AS waiter_username, u.full_name AS waiter_full_name,
              t.id AS table_id, t.name AS table_name
         FROM orders o
         JOIN users u ON u.id = o.waiter_id
         LEFT JOIN tables t ON t.id = o.table_id
        WHERE o.id = $1`,
      [orderId],
    );
    if (!order.rows[0]) throw new NotFoundException('Order not found');

    const items = await this.db.query(
      `SELECT oi.id, oi.product_id, p.name AS product_name, oi.quantity,
              oi.unit_price, oi.line_total, oi.station, oi.notes
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC`,
      [orderId],
    );

    const jobs = await this.db.query(
      `SELECT pj.id, pj.ticket_type, pj.status, pj.attempts,
              pr.id AS printer_id, pr.name AS printer_name, pr.station AS printer_station
         FROM print_jobs pj
         JOIN printers pr ON pr.id = pj.printer_id
        WHERE pj.order_id = $1
        ORDER BY pj.created_at ASC`,
      [orderId],
    );

    const row = order.rows[0];
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      orderType: row.order_type,
      subtotal: row.subtotal,
      discountAmount: row.discount_amount,
      totalAmount: row.total_amount,
      paidAmount: row.paid_amount,
      currency: row.currency,
      notes: row.notes,
      clientUuid: row.client_uuid,
      syncStatus: row.sync_status,
      clientCreatedAt: row.client_created_at,
      serverCreatedAt: row.server_created_at,
      cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason,
      waiter: { id: row.waiter_id, username: row.waiter_username, fullName: row.waiter_full_name },
      table: row.table_id ? { id: row.table_id, name: row.table_name } : null,
      items: items.rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        quantity: r.quantity,
        unitPrice: r.unit_price,
        lineTotal: r.line_total,
        station: r.station,
        notes: r.notes,
      })),
      printJobs: jobs.rows.map((r) => ({
        id: r.id,
        ticketType: r.ticket_type,
        status: r.status,
        attempts: r.attempts,
        printer: { id: r.printer_id, name: r.printer_name, station: r.printer_station },
      })),
    };
  }

  async cancel(orderId: string, reason: string, authUser: AuthUser) {
    const result = await this.db.transaction(async (client) => {
      const cur = await client.query(
        `SELECT id, order_number, status, cancelled_at
           FROM orders
          WHERE id = $1
          FOR UPDATE`,
        [orderId],
      );
      if (!cur.rows[0]) throw new NotFoundException('Order not found');
      if (cur.rows[0].cancelled_at) {
        throw new ConflictException({
          code: 'ALREADY_CANCELLED',
          message: 'Order is already cancelled.',
        });
      }
      await client.query(
        `UPDATE orders
            SET cancelled_at = now(),
                cancelled_by = $2,
                cancellation_reason = $3,
                status = 'CANCELLED'::"OrderStatus",
                updated_at = now()
          WHERE id = $1`,
        [orderId, authUser.userId, reason],
      );
      return cur.rows[0].order_number;
    });
    this.logger.log(`Order ${result} cancelled by ${authUser.username}`);
    return this.fetchFullOrder(orderId);
  }

  async appendItems(orderId: string, dto: AppendItemsDto, authUser: AuthUser) {
    // -------- Idempotency fast path (sequential retries) --------
    const already = await this.db.query<{ order_id: string }>(
      `SELECT order_id FROM order_append_batches WHERE client_uuid = $1`,
      [dto.clientUuid],
    );
    if (already.rows[0]) {
      return this.fetchFullOrder(already.rows[0].order_id);
    }

    // -------- Validate all products before opening a tx --------
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const productRes = await this.db.query<ProductRow>(
      `SELECT id, name, selling_price, preparation_station, is_active
         FROM products WHERE id = ANY($1::uuid[])`,
      [productIds],
    );
    const productRows = productRes.rows as ProductRow[];
    const productMap: Map<string, ProductRow> = new Map(
      productRows.map((p) => [p.id, p]),
    );

    const invalidItems: { productId: string; reason: string }[] = [];
    for (const item of dto.items) {
      const p = productMap.get(item.productId);
      if (!p) invalidItems.push({ productId: item.productId, reason: 'NOT_FOUND' });
      else if (!p.is_active) invalidItems.push({ productId: item.productId, reason: 'INACTIVE' });
    }
    if (invalidItems.length > 0) {
      throw new BadRequestException({
        message: 'One or more products are invalid. Order was not changed.',
        invalidItems,
      });
    }

    // -------- Main transaction --------
    try {
      await this.db.transaction(async (client) => {
        // Lock the order to serialize concurrent appends.
        const cur = await client.query<{
          id: string;
          order_number: string;
          cancelled_at: string | null;
          waiter_id: string;
        }>(
          `SELECT id, order_number, cancelled_at, waiter_id
             FROM orders WHERE id = $1 FOR UPDATE`,
          [orderId],
        );
        const order = cur.rows[0];
        if (!order) throw new NotFoundException('Order not found');
        if (order.cancelled_at) {
          throw new BadRequestException({
            code: 'ORDER_CANCELLED',
            message: 'Cannot add items to a cancelled order.',
          });
        }
        if (authUser.role === 'WAITER' && order.waiter_id !== authUser.userId) {
          throw new ForbiddenException('This order belongs to another waiter.');
        }

        // Insert the batch marker FIRST. The PK makes concurrent retries safe:
        // the second caller's INSERT throws 23505 before touching order_items.
        await client.query(
          `INSERT INTO order_append_batches (client_uuid, order_id) VALUES ($1, $2)`,
          [dto.clientUuid, orderId],
        );

        // Build line records with server-authoritative prices.
        const lines = dto.items.map((it) => {
          const p = productMap.get(it.productId)!;
          const unit = parseFloat(p.selling_price);
          return {
            productId: p.id,
            productName: p.name,
            quantity: it.quantity,
            unitPrice: unit,
            lineTotal: +(unit * it.quantity).toFixed(2),
            station: p.preparation_station as Station,
            notes: it.notes ?? null,
          };
        });

        // Insert every line — plain INSERTs, no client_uuid on items.
        for (const l of lines) {
          await client.query(
            `INSERT INTO order_items
               (order_id, product_id, quantity, unit_price, line_total, station, notes)
             VALUES ($1, $2, $3, $4, $5, $6::"Station", $7)`,
            [orderId, l.productId, l.quantity, l.unitPrice, l.lineTotal, l.station, l.notes],
          );
        }

        // Recompute subtotal / total from ALL items on the order.
        const sum = await client.query<{ subtotal: string }>(
          `SELECT COALESCE(SUM(line_total), 0)::numeric(12,2) AS subtotal
             FROM order_items WHERE order_id = $1`,
          [orderId],
        );
        const newSubtotal = sum.rows[0].subtotal;

        await client.query(
          `UPDATE orders
              SET subtotal = $2,
                  total_amount = $2 - discount_amount,
                  updated_at = now()
            WHERE id = $1`,
          [orderId, newSubtotal],
        );

        // Print jobs for the NEW items only.
        const ctx = await client.query<{ waiter_name: string; table_name: string | null; order_type: string }>(
          `SELECT u.full_name AS waiter_name, t.name AS table_name, o.order_type
             FROM orders o
             JOIN users u ON u.id = o.waiter_id
             LEFT JOIN tables t ON t.id = o.table_id
            WHERE o.id = $1`,
          [orderId],
        );
        const waiterFullName = ctx.rows[0]?.waiter_name ?? authUser.username;
        const tableName = ctx.rows[0]?.table_name ?? null;
        const orderType = ctx.rows[0]?.order_type ?? 'DINE_IN';

        const byStation = new Map<Station, typeof lines>();
        for (const l of lines) {
          if (!byStation.has(l.station)) byStation.set(l.station, []);
          byStation.get(l.station)!.push(l);
        }

        for (const [station, stationLines] of byStation.entries()) {
          if (station === Station.NONE) continue;
          const printer = await this.printers.findPrinterForStation(client, station);
          if (!printer) continue;
          const payload = buildKitchenBarTicket({
            orderNumber: order.order_number,
            station,
            waiterFullName,
            tableName,
            orderType,
            orderNotes: null,
            createdAt: new Date().toISOString(),
            lines: stationLines.map((l) => ({
              productName: l.productName,
              quantity: l.quantity,
              notes: l.notes,
            })),
          });
          const ticketType =
            station === Station.KITCHEN ? PrintTicketType.KITCHEN : PrintTicketType.BAR;
          await client.query(
            `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status)
             VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING')`,
            [orderId, printer.id, ticketType, payload],
          );
        }
      });

      return this.fetchFullOrder(orderId);
    } catch (err: any) {
      // Concurrent retry with the same clientUuid — the batch marker
      // insert collided. The other caller won; return its order.
      if (err?.code === '23505' && String(err.constraint || '').includes('order_append_batches')) {
        const dup = await this.db.query<{ order_id: string }>(
          `SELECT order_id FROM order_append_batches WHERE client_uuid = $1`,
          [dto.clientUuid],
        );
        if (dup.rows[0]) return this.fetchFullOrder(dup.rows[0].order_id);
      }
      throw err;
    }
  }

  async listForUser(authUser: AuthUser, limit = 50) {
    const isPrivileged = ['MANAGER', 'ADMIN', 'CASHIER'].includes(authUser.role);
    const sql = `
      SELECT o.id, o.order_number, o.status, o.order_type, o.total_amount, o.currency,
             o.client_created_at, o.server_created_at,
             u.username AS waiter_username, u.full_name AS waiter_full_name
        FROM orders o
        JOIN users u ON u.id = o.waiter_id
       WHERE ($1::uuid IS NULL OR o.waiter_id = $1)
       ORDER BY o.server_created_at DESC
       LIMIT $2`;
    const waiterFilter = isPrivileged ? null : authUser.userId;
    const r = await this.db.query(sql, [waiterFilter, limit]);
    return {
      count: r.rows.length,
      orders: r.rows.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type,
        totalAmount: o.total_amount,
        currency: o.currency,
        clientCreatedAt: o.client_created_at,
        serverCreatedAt: o.server_created_at,
        waiter: { username: o.waiter_username, fullName: o.waiter_full_name },
      })),
    };
  }
}
