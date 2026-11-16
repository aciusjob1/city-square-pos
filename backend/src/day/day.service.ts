import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from '../orders/orders.service';

export type DayRolloverMode = 'AUTO' | 'MANUAL';

interface SessionStats {
  totalSales: string;
  orderCount: number;
  cancelledCount: number;
  cancelledTotal: string;
}

@Injectable()
export class DayService {
  constructor(private readonly db: DatabaseService) {}

  async mode(): Promise<DayRolloverMode> {
    const r = await this.db.query(
      `SELECT value FROM settings WHERE key = 'day.rollover_mode'`,
    );
    return r.rows[0]?.value === 'AUTO' ? 'AUTO' : 'MANUAL';
  }

  private async today(): Promise<string> {
    const r = await this.db.query(
      `SELECT to_char((now() AT TIME ZONE 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD') AS today`,
    );
    return r.rows[0].today;
  }

  private async sessionStats(
    client: DatabaseService | PoolClient,
    openedAt: Date,
    closedAt: Date | null,
  ): Promise<SessionStats> {
    const r = await (client as any).query(
      `SELECT COALESCE(SUM(o.total_amount) FILTER (WHERE o.cancelled_at IS NULL), 0) AS total_sales,
              COUNT(*) FILTER (WHERE o.cancelled_at IS NULL)::int AS order_count,
              COUNT(*) FILTER (WHERE o.cancelled_at IS NOT NULL)::int AS cancelled_count,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.cancelled_at IS NOT NULL), 0) AS cancelled_total
         FROM orders o
        WHERE o.server_created_at >= $1
          AND ($2::timestamptz IS NULL OR o.server_created_at <= $2)`,
      [openedAt, closedAt],
    );
    const s = r.rows[0];
    return {
      totalSales: s.total_sales,
      orderCount: s.order_count,
      cancelledCount: s.cancelled_count,
      cancelledTotal: s.cancelled_total,
    };
  }

  private async openOrdersSince(client: PoolClient, openedAt: Date): Promise<number> {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM orders
        WHERE closed_at IS NULL
          AND cancelled_at IS NULL
          AND server_created_at >= $1`,
      [openedAt],
    );
    return r.rows[0].n;
  }

  private async openRow() {
    const r = await this.db.query(
      `SELECT d.id,
              to_char(d.business_date, 'YYYY-MM-DD') AS business_date,
              d.opened_at,
              u.full_name AS opened_by_name
         FROM business_days d
         LEFT JOIN users u ON u.id = d.opened_by
        WHERE d.closed_at IS NULL
        LIMIT 1`,
    );
    return r.rows[0] ?? null;
  }

  /**
   * In AUTO mode a stale open session is closed and a new one opened as soon
   * as anyone asks for the day status. opened_at is pinned to midnight of the
   * business date so the new session captures the whole day.
   */
  private async autoRollover(): Promise<void> {
    await this.db.transaction(async (client) => {
      const today = await this.today();
      const cur = await client.query(
        `SELECT id, to_char(business_date, 'YYYY-MM-DD') AS business_date, opened_at
           FROM business_days
          WHERE closed_at IS NULL
          FOR UPDATE`,
      );
      if (!cur.rows[0]) {
        await client.query(
          `INSERT INTO business_days (business_date, opened_at)
           VALUES ($1::date, $1::date::timestamp AT TIME ZONE 'Africa/Dar_es_Salaam')`,
          [today],
        );
        return;
      }
      const row = cur.rows[0];
      if (row.business_date >= today) return;
      const stats = await this.sessionStats(client, row.opened_at, null);
      await client.query(
        `UPDATE business_days
            SET closed_at = now(),
                total_sales = $2, order_count = $3,
                cancelled_count = $4, cancelled_total = $5
          WHERE id = $1`,
        [row.id, stats.totalSales, stats.orderCount, stats.cancelledCount, stats.cancelledTotal],
      );
      await client.query(
        `INSERT INTO business_days (business_date, opened_at)
         VALUES ($1::date, $1::date::timestamp AT TIME ZONE 'Africa/Dar_es_Salaam')`,
        [today],
      );
    });
  }

  async status() {
    const mode = await this.mode();
    if (mode === 'AUTO') await this.autoRollover();

    const today = await this.today();
    const open = await this.openRow();
    let openDay: Record<string, unknown> | null = null;
    if (open) {
      const summary = await this.sessionStats(this.db, open.opened_at, null);
      openDay = {
        id: open.id,
        businessDate: open.business_date,
        openedAt: open.opened_at,
        openedByName: open.opened_by_name,
        summary,
      };
    }

    const history = await this.db.query(
      `SELECT d.id,
              to_char(d.business_date, 'YYYY-MM-DD') AS business_date,
              d.opened_at, d.closed_at,
              d.total_sales, d.order_count,
              d.cancelled_count, d.cancelled_total,
              u.full_name AS closed_by_name
         FROM business_days d
         LEFT JOIN users u ON u.id = d.closed_by
        WHERE d.closed_at IS NOT NULL
        ORDER BY d.closed_at DESC
        LIMIT 7`,
    );
    const recentDays = history.rows.map((d: any) => ({
      id: d.id,
      businessDate: d.business_date,
      openedAt: d.opened_at,
      closedAt: d.closed_at,
      totalSales: d.total_sales,
      orderCount: d.order_count,
      cancelledCount: d.cancelled_count,
      cancelledTotal: d.cancelled_total,
      closedByName: d.closed_by_name,
    }));

    return {
      mode,
      today,
      openDay,
      lastClosedDay: recentDays[0] ?? null,
      recentDays,
    };
  }

  async close(authUser: AuthUser, force = false) {
    await this.db.transaction(async (client) => {
      const cur = await client.query(
        `SELECT id, to_char(business_date, 'YYYY-MM-DD') AS business_date, opened_at
           FROM business_days
          WHERE closed_at IS NULL
          FOR UPDATE`,
      );
      if (!cur.rows[0]) {
        throw new BadRequestException({
          code: 'NO_OPEN_DAY',
          message: 'There is no open business day to close.',
        });
      }
      const row = cur.rows[0];
      const openCount = await this.openOrdersSince(client, row.opened_at);
      if (openCount > 0 && !force) {
        throw new ConflictException({
          code: 'OPEN_ORDERS',
          message: `${openCount} order${openCount === 1 ? ' is' : 's are'} still open. Close or cancel them, or force-close the day.`,
          openOrders: openCount,
        });
      }
      const stats = await this.sessionStats(client, row.opened_at, null);
      await client.query(
        `UPDATE business_days
            SET closed_at = now(), closed_by = $2,
                total_sales = $3, order_count = $4,
                cancelled_count = $5, cancelled_total = $6
          WHERE id = $1`,
        [
          row.id, authUser.userId, stats.totalSales, stats.orderCount,
          stats.cancelledCount, stats.cancelledTotal,
        ],
      );
    });
    return { ok: true, ...(await this.status()) };
  }

  async open(authUser: AuthUser) {
    await this.db.transaction(async (client) => {
      const cur = await client.query(
        `SELECT id FROM business_days WHERE closed_at IS NULL FOR UPDATE`,
      );
      if (cur.rows[0]) {
        throw new ConflictException({
          code: 'DAY_ALREADY_OPEN',
          message: 'A business day is already open. Close it before opening another.',
        });
      }
      const today = await this.today();
      await client.query(
        `INSERT INTO business_days (business_date, opened_at, opened_by)
         VALUES ($1::date, now(), $2)`,
        [today, authUser.userId],
      );
    });
    return { ok: true, ...(await this.status()) };
  }

  async rollover(authUser: AuthUser, force = false) {
    await this.db.transaction(async (client) => {
      const cur = await client.query(
        `SELECT id, to_char(business_date, 'YYYY-MM-DD') AS business_date, opened_at
           FROM business_days
          WHERE closed_at IS NULL
          FOR UPDATE`,
      );
      if (cur.rows[0]) {
        const row = cur.rows[0];
        const openCount = await this.openOrdersSince(client, row.opened_at);
        if (openCount > 0 && !force) {
          throw new ConflictException({
            code: 'OPEN_ORDERS',
            message: `${openCount} order${openCount === 1 ? ' is' : 's are'} still open. Close or cancel them, or force the rollover.`,
            openOrders: openCount,
          });
        }
        const stats = await this.sessionStats(client, row.opened_at, null);
        await client.query(
          `UPDATE business_days
              SET closed_at = now(), closed_by = $2,
                  total_sales = $3, order_count = $4,
                  cancelled_count = $5, cancelled_total = $6
            WHERE id = $1`,
          [
            row.id, authUser.userId, stats.totalSales, stats.orderCount,
            stats.cancelledCount, stats.cancelledTotal,
          ],
        );
      }
      const today = await this.today();
      await client.query(
        `INSERT INTO business_days (business_date, opened_at, opened_by)
         VALUES ($1::date, now(), $2)`,
        [today, authUser.userId],
      );
    });
    return { ok: true, ...(await this.status()) };
  }
}
