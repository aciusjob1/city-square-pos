import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TableRow {
  id: string;
  name: string;
  capacity: number;
  area: string | null;
  is_active: boolean;
}

const MANAGED_TABLE_NAME = /^table\s+(\d+)$/i;

@Injectable()
export class TablesService {
  constructor(private readonly db: DatabaseService) {}

  async list(authUser?: { userId: string; role: string }) {
    // Waiters only ever resume their own order. The partial unique index is
    // keyed on (table_id, waiter_id), so two waiters can legitimately have
    // active orders on the same table — surfacing someone else's id here
    // would (a) leak it and (b) make the waiter append to a forbidden order.
    const waiterFilter = authUser?.role === 'WAITER' ? authUser.userId : null;
    const r = await this.db.query<TableRow & { active_order_id: string | null }>(
      `SELECT t.id, t.name, t.capacity, t.area, t.is_active,
              (SELECT o.id FROM orders o
                WHERE o.table_id = t.id
                  AND o.cancelled_at IS NULL
                  AND o.closed_at IS NULL
                  AND ($1::uuid IS NULL OR o.waiter_id = $1)
                ORDER BY o.server_created_at ASC
                LIMIT 1) AS active_order_id
         FROM tables t
        WHERE t.is_active = true
        ORDER BY NULLIF(regexp_replace(t.name, '\\D', '', 'g'), '')::int NULLS LAST,
                 t.name ASC`,
      [waiterFilter],
    );
    return {
      tables: r.rows.map((t) => ({
        id: t.id,
        name: t.name,
        capacity: t.capacity,
        area: t.area,
        activeOrderId: t.active_order_id,
      })),
    };
  }

  async activeOrderForTable(tableId: string, authUser?: { userId: string; role: string }) {
    const tbl = await this.db.query(`SELECT id FROM tables WHERE id = $1`, [tableId]);
    if (!tbl.rows[0]) throw new NotFoundException('Table not found');

    const waiterFilter = authUser?.role === 'WAITER' ? authUser.userId : null;
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM orders
        WHERE table_id = $1
          AND cancelled_at IS NULL
          AND closed_at IS NULL
          AND ($2::uuid IS NULL OR waiter_id = $2)
        ORDER BY server_created_at ASC
        LIMIT 1`,
      [tableId, waiterFilter],
    );
    return { activeOrderId: r.rows[0]?.id ?? null };
  }

  async getConfig() {
    const managed = await this.db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM tables
        WHERE is_active = true AND name ~* '^table\\s+[0-9]+$'`,
    );
    const all = await this.db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM tables WHERE is_active = true`,
    );
    return {
      tableCount: parseInt(managed.rows[0].n, 10),
      totalActiveTables: parseInt(all.rows[0].n, 10),
    };
  }

  /**
   * Sets how many "Table N" tables waiters can see. Missing tables are
   * created, previously deactivated ones are reactivated, and surplus
   * tables are deactivated (never deleted, so order history survives).
   * Removing a table that still has an open order is rejected.
   */
  async setCount(count: number) {
    return this.db.transaction(async (client) => {
      const existing = await client.query<TableRow>(
        `SELECT id, name, is_active FROM tables
          WHERE name ~* '^table\\s+[0-9]+$'
          ORDER BY name
          FOR UPDATE`,
      );

      const byNumber = new Map<number, TableRow>();
      for (const row of existing.rows) {
        const match = MANAGED_TABLE_NAME.exec(row.name);
        if (match) byNumber.set(parseInt(match[1], 10), row);
      }

      const surplus = [...byNumber.entries()]
        .filter(([n, row]) => n > count && row.is_active)
        .sort((a, b) => b[0] - a[0]);

      if (surplus.length > 0) {
        const busy = await client.query<{ name: string }>(
          `SELECT DISTINCT t.name
             FROM tables t
             JOIN orders o ON o.table_id = t.id
            WHERE t.id = ANY($1::uuid[])
              AND o.cancelled_at IS NULL
              AND o.closed_at IS NULL`,
          [surplus.map(([, row]) => row.id)],
        );
        if (busy.rows.length > 0) {
          throw new ConflictException(
            `Cannot reduce tables: ${busy.rows.map((r) => r.name).join(', ')} ` +
              'still have open orders. Close them first.',
          );
        }
        await client.query(
          `UPDATE tables SET is_active = false WHERE id = ANY($1::uuid[])`,
          [surplus.map(([, row]) => row.id)],
        );
      }

      for (let n = 1; n <= count; n++) {
        const row = byNumber.get(n);
        if (!row) {
          await client.query(
            `INSERT INTO tables (name, capacity, area) VALUES ($1, 4, 'Main')`,
            [`Table ${n}`],
          );
        } else if (!row.is_active) {
          await client.query(`UPDATE tables SET is_active = true WHERE id = $1`, [row.id]);
        }
      }

      const active = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM tables WHERE is_active = true`,
      );
      return {
        tableCount: count,
        totalActiveTables: parseInt(active.rows[0].n, 10),
      };
    });
  }
}
