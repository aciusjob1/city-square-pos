import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TableRow {
  id: string;
  name: string;
  capacity: number;
  area: string | null;
  is_active: boolean;
}

@Injectable()
export class TablesService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    // Use a scalar subquery so a table with multiple active orders
    // (John's + Fatma's on the same table) still returns exactly ONE row.
    // The LEFT JOIN approach would return N rows for a table with N active orders.
    const r = await this.db.query<TableRow & { active_order_id: string | null }>(
      `SELECT t.id, t.name, t.capacity, t.area, t.is_active,
              (SELECT o.id FROM orders o
                WHERE o.table_id = t.id
                  AND o.cancelled_at IS NULL
                  AND o.closed_at IS NULL
                ORDER BY o.server_created_at ASC
                LIMIT 1) AS active_order_id
         FROM tables t
        WHERE t.is_active = true
        ORDER BY t.name ASC`,
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

  async activeOrderForTable(tableId: string) {
    const tbl = await this.db.query(`SELECT id FROM tables WHERE id = $1`, [tableId]);
    if (!tbl.rows[0]) throw new NotFoundException('Table not found');

    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM orders
        WHERE table_id = $1
          AND cancelled_at IS NULL
          AND closed_at IS NULL
        ORDER BY server_created_at ASC
        LIMIT 1`,
      [tableId],
    );
    return { activeOrderId: r.rows[0]?.id ?? null };
  }
}
