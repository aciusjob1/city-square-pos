import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Read-only daily sales aggregation.
   * - Uses Africa/Dar_es_Salaam business date.
   * - Excludes cancelled orders.
   * - Groups by waiter and by hour, plus top products.
   * - No payment tracking: totals come from orders.total_amount.
   */
  async dailySales(dateYYYYMMDD: string) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(dateYYYYMMDD)) {
      throw new Error('date must be YYYY-MM-DD');
    }

    const totals = await this.db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total,
              COUNT(*)                        AS order_count,
              COALESCE(AVG(total_amount), 0)  AS avg_order
         FROM orders
        WHERE (created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date
          AND cancelled_at IS NULL`,
      [dateYYYYMMDD],
    );

    const byWaiter = await this.db.query(
      `SELECT u.id, u.username, u.full_name,
              COUNT(o.id)                     AS order_count,
              COALESCE(SUM(o.total_amount),0) AS total
         FROM orders o
         JOIN users u ON u.id = o.waiter_id
        WHERE (o.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date
          AND o.cancelled_at IS NULL
        GROUP BY u.id, u.username, u.full_name
        ORDER BY total DESC`,
      [dateYYYYMMDD],
    );

    const byHour = await this.db.query(
      `SELECT to_char(date_trunc('hour', created_at AT TIME ZONE 'Africa/Dar_es_Salaam'), 'HH24:00') AS hour,
              COUNT(*)                        AS order_count,
              COALESCE(SUM(total_amount), 0)  AS total
         FROM orders
        WHERE (created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date
          AND cancelled_at IS NULL
        GROUP BY 1
        ORDER BY 1`,
      [dateYYYYMMDD],
    );

    const topProducts = await this.db.query(
      `SELECT p.id, p.name,
              SUM(oi.quantity)        AS qty_sold,
              SUM(oi.line_total)      AS revenue
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders   o ON o.id = oi.order_id
        WHERE (o.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date
          AND o.cancelled_at IS NULL
        GROUP BY p.id, p.name
        ORDER BY revenue DESC
        LIMIT 10`,
      [dateYYYYMMDD],
    );

    const cancelled = await this.db.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS total
         FROM orders
        WHERE (created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = $1::date
          AND cancelled_at IS NOT NULL`,
      [dateYYYYMMDD],
    );

    return {
      date: dateYYYYMMDD,
      currency: 'TZS',
      summary: {
        totalSales: totals.rows[0].total,
        orderCount: parseInt(totals.rows[0].order_count, 10),
        avgOrderValue: totals.rows[0].avg_order,
        cancelledCount: parseInt(cancelled.rows[0].n, 10),
        cancelledTotal: cancelled.rows[0].total,
      },
      byWaiter: byWaiter.rows,
      byHour: byHour.rows,
      topProducts: topProducts.rows,
    };
  }
}
