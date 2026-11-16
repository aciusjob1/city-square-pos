import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AppendItemsDto } from './dto/append-items.dto';
import { allocateOrderNumber } from '../common/utils/order-number';
import { loadRestaurantName } from '../common/branding';
import { buildKitchenBarTicket } from '../printers/ticket.builders';
import { PrintersService } from '../printers/printers.service';
import { PrinterDispatchService } from '../printers/printer-dispatch.service';
import { PrintTicketType, Station } from '../printers/station.enum';
import { StockService } from '../stock/stock.service';

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
  is_available: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly printers: PrintersService,
    private readonly stock: StockService,
    private readonly dispatch: PrinterDispatchService,
  ) {}

  async create(dto: CreateOrderDto, authUser: AuthUser) {
    // -------- Idempotency fast path (sequential retries) --------
    // Scoped to the caller: every order is created with waiter_id = caller,
    // so another user's client_uuid must never resolve to an order here.
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE client_uuid = $1 AND waiter_id = $2 LIMIT 1`,
      [dto.clientUuid, authUser.userId],
    );
    if (existing.rows[0]) {
      return this.fetchFullOrder(existing.rows[0].id);
    }

    // -------- Validate the table up front (400 instead of FK 500) --------
    if (dto.tableId) {
      const table = await this.db.query(
        `SELECT id FROM tables WHERE id = $1 AND is_active = true`,
        [dto.tableId],
      );
      if (!table.rows[0]) {
        throw new BadRequestException({
          code: 'TABLE_NOT_FOUND',
          message: 'Table not found or inactive.',
        });
      }
    }

    // -------- Validate all products before opening a tx --------
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const productRes = await this.db.query<ProductRow>(
      `SELECT p.id, p.name, p.selling_price,
              COALESCE(c.printer_station, p.preparation_station) AS preparation_station,
              p.is_active, p.is_available, p.stock_managed
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ANY($1::uuid[])`,
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
      else if (!p.is_available) invalidItems.push({ productId: item.productId, reason: 'UNAVAILABLE' });
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
        await this.stock.checkAvailabilityForOrder(
          client,
          dto.items.map((it) => {
            const p = productMap.get(it.productId)!;
            return { productId: p.id, quantity: it.quantity, stockManaged: (p as any).stock_managed };
          }),
        );

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

        const restaurantName = await loadRestaurantName(this.db);
        for (const [station, stationLines] of byStation.entries()) {
          if (station === Station.NONE) continue;
          const printer = await this.printers.findPrinterForStation(client, station);
          const payload = buildKitchenBarTicket({
            restaurantName,
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
          await this.insertStationJob(client, newOrderId, ticketType, payload, printer, station);
        }

        return newOrderId;
      });

      this.dispatch.kick();
      return this.fetchFullOrder(orderId);
    } catch (err: any) {
      // 23505 = unique_violation — happens when two concurrent requests
      // carry the same client_uuid. The other one won; return its order.
      // (a) Concurrent retry with the same clientUuid — return the winner.
      if (err?.code === '23505' && String(err.detail || '').includes('client_uuid')) {
        const dup = await this.db.query<{ id: string }>(
          `SELECT id FROM orders WHERE client_uuid = $1 AND waiter_id = $2 LIMIT 1`,
          [dto.clientUuid, authUser.userId],
        );
        if (dup.rows[0]) return this.fetchFullOrder(dup.rows[0].id);
        throw new ConflictException({
          code: 'CLIENT_UUID_CONFLICT',
          message: 'That request id is already in use.',
        });
      }
      // (b) Concurrent creation for a table that already has an active order —
      //     the DB partial unique index refused a second active row. Return
      //     the caller's existing active order so the client behaves as if
      //     it "resumed". Scoped to the caller because the index is keyed on
      //     (table_id, waiter_id) — another waiter may have their own order.
      if (
        err?.code === '23505' &&
        String(err.constraint || '').includes('orders_one_active_per_table') &&
        dto.tableId
      ) {
        const existing = await this.db.query<{ id: string }>(
          `SELECT id FROM orders
            WHERE table_id = $1
              AND waiter_id = $2
              AND cancelled_at IS NULL
              AND closed_at IS NULL
            LIMIT 1`,
          [dto.tableId, authUser.userId],
        );
        if (existing.rows[0]) return this.fetchFullOrder(existing.rows[0].id);
      }
      // Foreign key to a table/product that vanished between validation and
      // insert — surface as a client error, not a 500.
      if (err?.code === '23503') {
        throw new BadRequestException({
          code: 'INVALID_REFERENCE',
          message: 'Order references a table or product that no longer exists.',
        });
      }
      throw err;
    }
  }

  /**
   * Full order read, scoped by role. Waiters may only read their own orders;
   * cashiers/managers/admins need cross-waiter visibility for billing.
   */
  async fetchFullOrderForUser(orderId: string, authUser: AuthUser) {
    const order = await this.fetchFullOrder(orderId);
    if (authUser.role === 'WAITER' && order.waiter.id !== authUser.userId) {
      throw new ForbiddenException('This order belongs to another waiter.');
    }
    return order;
  }

  async fetchFullOrder(orderId: string) {
    const order = await this.db.query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal,
              o.discount_amount, o.total_amount, o.paid_amount, o.currency,
              o.notes, o.client_uuid, o.sync_status,
              o.client_created_at, o.server_created_at,
              o.cancelled_at, o.cancellation_reason, o.closed_at, o.bill_group_id,
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
              pr.id AS printer_id, pr.name AS printer_name,
              COALESCE((
                SELECT array_agg(ps.station::text ORDER BY ps.station)
                  FROM printer_stations ps
                 WHERE ps.printer_id = pr.id
              ), '{}') AS printer_stations
         FROM print_jobs pj
         LEFT JOIN printers pr ON pr.id = pj.printer_id
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
      closedAt: row.closed_at,
      billGroupId: row.bill_group_id,
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
        printer: r.printer_id
          ? { id: r.printer_id, name: r.printer_name, stations: r.printer_stations }
          : null,
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
    const already = await this.db.query<{ order_id: string; waiter_id: string }>(
      `SELECT b.order_id, o.waiter_id
         FROM order_append_batches b
         JOIN orders o ON o.id = b.order_id
        WHERE b.client_uuid = $1`,
      [dto.clientUuid],
    );
    if (already.rows[0]) {
      if (authUser.role === 'WAITER' && already.rows[0].waiter_id !== authUser.userId) {
        throw new ForbiddenException('This order belongs to another waiter.');
      }
      return this.fetchFullOrder(already.rows[0].order_id);
    }

    // -------- Validate all products before opening a tx --------
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const productRes = await this.db.query<ProductRow>(
      `SELECT p.id, p.name, p.selling_price,
              COALESCE(c.printer_station, p.preparation_station) AS preparation_station,
              p.is_active, p.is_available, p.stock_managed
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ANY($1::uuid[])`,
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
      else if (!p.is_available) invalidItems.push({ productId: item.productId, reason: 'UNAVAILABLE' });
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
          `SELECT id, order_number, cancelled_at, closed_at, waiter_id
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
        if ((order as any).closed_at) {
          throw new BadRequestException({
            code: 'ORDER_CLOSED',
            message: 'Order is closed. Create a new order for this table.',
          });
        }
        if (authUser.role === 'WAITER' && order.waiter_id !== authUser.userId) {
          throw new ForbiddenException('This order belongs to another waiter.');
        }

        await this.stock.checkAvailabilityForOrder(

          client,

          dto.items.map((it) => {

            const p = productMap.get(it.productId)!;

            return { productId: p.id, quantity: it.quantity, stockManaged: (p as any).stock_managed };

          }),

        );


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

        const restaurantName = await loadRestaurantName(this.db);
        for (const [station, stationLines] of byStation.entries()) {
          if (station === Station.NONE) continue;
          const printer = await this.printers.findPrinterForStation(client, station);
          const payload = buildKitchenBarTicket({
            restaurantName,
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
          await this.insertStationJob(client, orderId, ticketType, payload, printer, station);
        }
      });

      this.dispatch.kick();
      return this.fetchFullOrder(orderId);
    } catch (err: any) {
      // Concurrent retry with the same clientUuid — the batch marker
      // insert collided. The other caller won; return its order.
      if (err?.code === '23505' && String(err.constraint || '').includes('order_append_batches')) {
        const dup = await this.db.query<{ order_id: string; waiter_id: string }>(
          `SELECT b.order_id, o.waiter_id
             FROM order_append_batches b
             JOIN orders o ON o.id = b.order_id
            WHERE b.client_uuid = $1`,
          [dto.clientUuid],
        );
        if (dup.rows[0]) {
          if (authUser.role === 'WAITER' && dup.rows[0].waiter_id !== authUser.userId) {
            throw new ForbiddenException('This order belongs to another waiter.');
          }
          return this.fetchFullOrder(dup.rows[0].order_id);
        }
      }
      throw err;
    }
  }

  /**
   * Creates exactly one print job per station. When a station has no active
   * printer the ticket is stored as FAILED (with the payload) instead of being
   * dropped, so a mixed kitchen/bar order never loses half its items silently
   * and Print Jobs shows precisely what could not be printed.
   */
  private async insertStationJob(
    client: PoolClient,
    orderId: string,
    ticketType: PrintTicketType,
    payload: string,
    printer: { id: string } | null,
    station: Station,
  ) {
    if (printer) {
      await client.query(
        `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status)
         VALUES ($1, $2, $3::"PrintTicketType", $4, 'PENDING')`,
        [orderId, printer.id, ticketType, payload],
      );
      return;
    }

    this.logger.warn(
      `No active printer for station ${station} on order ${orderId}; ticket stored as FAILED`,
    );
    await client.query(
      `INSERT INTO print_jobs (order_id, printer_id, ticket_type, payload, status, last_error)
       VALUES ($1, NULL, $2::"PrintTicketType", $3, 'FAILED', $4)`,
      [orderId, ticketType, payload, `No active printer is assigned to the ${station} station`],
    );
  }

  async listForUser(
    authUser: AuthUser,
    limit = 50,
    from: string | null = null,
    to: string | null = null,
  ) {
    const isPrivileged = ['MANAGER', 'ADMIN', 'CASHIER'].includes(authUser.role);
    const sql = `
      SELECT o.id, o.order_number, o.status, o.order_type, o.total_amount, o.currency,
             o.client_created_at, o.server_created_at, o.closed_at,
             o.cancelled_at, o.cancellation_reason, o.bill_group_id,
             u.username AS waiter_username, u.full_name AS waiter_full_name
        FROM orders o
        JOIN users u ON u.id = o.waiter_id
       WHERE ($1::uuid IS NULL OR o.waiter_id = $1)
         AND ($3::date IS NULL
              OR (o.server_created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date >= $3::date)
         AND ($4::date IS NULL
              OR (o.server_created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date <= $4::date)
       ORDER BY o.server_created_at DESC
       LIMIT $2`;
    const waiterFilter = isPrivileged ? null : authUser.userId;
    const r = await this.db.query(sql, [waiterFilter, limit, from, to]);
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
        closedAt: o.closed_at,
        cancelledAt: o.cancelled_at,
        cancellationReason: o.cancellation_reason,
        billGroupId: o.bill_group_id,
        waiter: { username: o.waiter_username, fullName: o.waiter_full_name },
      })),
    };
  }

  async listForKitchen(limit = 100) {
    const sql = `
      SELECT o.id, o.order_number, o.status, o.order_type, o.currency,
             o.server_created_at,
             u.username AS waiter_username, u.full_name AS waiter_full_name,
             t.name AS table_name
        FROM orders o
        JOIN users u ON u.id = o.waiter_id
   LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.status IN ('SENT_TO_KITCHEN', 'PREPARING')
         AND o.cancelled_at IS NULL
         AND o.closed_at IS NULL
       ORDER BY o.server_created_at ASC
       LIMIT $1`;

    const ordersResult = await this.db.query(sql, [limit]);
    if (ordersResult.rows.length === 0) {
      return { count: 0, orders: [] };
    }

    const orderIds = ordersResult.rows.map((r: any) => r.id);

    const itemsResult = await this.db.query(
      `SELECT oi.id, oi.order_id, p.name AS product_name, oi.quantity, oi.notes
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1::uuid[])
          AND oi.station = 'KITCHEN'
        ORDER BY oi.created_at ASC`,
      [orderIds],
    );

    const itemsByOrder = new Map<string, any[]>();
    for (const it of itemsResult.rows) {
      const list = itemsByOrder.get(it.order_id) ?? [];
      list.push({
        id: it.id,
        productName: it.product_name,
        quantity: it.quantity,
        notes: it.notes,
      });
      itemsByOrder.set(it.order_id, list);
    }

    return {
      count: ordersResult.rows.length,
      orders: ordersResult.rows.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type,
        tableName: o.table_name,
        waiterFullName: o.waiter_full_name,
        serverCreatedAt: o.server_created_at,
        items: itemsByOrder.get(o.id) ?? [],
      })),
    };
  }
}
