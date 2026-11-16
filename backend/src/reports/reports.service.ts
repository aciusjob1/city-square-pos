import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type TrendGranularity = 'day' | 'week' | 'month' | 'year';

const TREND_GRANULARITIES: readonly TrendGranularity[] = ['day', 'week', 'month', 'year'];

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

  /**
   * Range sales summary: product-wise and waiter-wise totals for any
   * inclusive date range (daily / weekly / monthly / yearly / custom).
   * Optional waiterId / productId narrow every aggregate, which answers
   * "what did this waiter sell" and "who sold this product".
   * Cancelled orders never count toward sales.
   */
  async salesSummary(
    from: string,
    to: string,
    search?: string,
    waiterId?: string,
    productId?: string,
    trendGranularity?: TrendGranularity,
  ) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(from) || !dateRe.test(to)) {
      throw new Error('from and to must be YYYY-MM-DD');
    }
    if (from > to) {
      throw new Error('from must be on or before to');
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (waiterId !== undefined && !uuidRe.test(waiterId)) {
      throw new Error('waiterId must be a valid identifier');
    }
    if (productId !== undefined && !uuidRe.test(productId)) {
      throw new Error('productId must be a valid identifier');
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs,
    ) + 1;
    if (spanDays > 400) {
      throw new Error('Date range cannot exceed 400 days');
    }
    if (trendGranularity !== undefined && !TREND_GRANULARITIES.includes(trendGranularity)) {
      throw new Error('granularity must be day, week, month or year');
    }

    const term = (search ?? '').trim().slice(0, 100);
    const searchPattern = term ? `%${term}%` : null;

    // Resolve filter labels so the UI can echo exactly what is applied.
    let waiter: { id: string; username: string; full_name: string } | null = null;
    let product: { id: string; name: string; category: string | null } | null = null;

    if (waiterId !== undefined) {
      const r = await this.db.query(
        `SELECT id, username, full_name FROM users WHERE id = $1::uuid`,
        [waiterId],
      );
      if (!r.rows[0]) throw new Error('Selected waiter was not found');
      waiter = r.rows[0];
    }
    if (productId !== undefined) {
      const r = await this.db.query(
        `SELECT p.id, p.name, c.name AS category
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1::uuid`,
        [productId],
      );
      if (!r.rows[0]) throw new Error('Selected product was not found');
      product = r.rows[0];
    }

    // $3 = waiter filter, $4 = product filter. Reused across every query.
    const inRange = `(o.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date BETWEEN $1::date AND $2::date`;
    const orderScope = `o.cancelled_at IS NULL
          AND ($3::uuid IS NULL OR o.waiter_id = $3)
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM order_items x
                 WHERE x.order_id = o.id AND x.product_id = $4))`;

    // A product filter reports that product's revenue; a waiter-only
    // filter reports the waiter's full order totals.
    const totals = product
      ? await this.db.query(
          `SELECT COALESCE(SUM(oi.line_total), 0) AS total,
                  COUNT(DISTINCT o.id)             AS order_count
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE ${inRange}
              AND ${orderScope}
              AND oi.product_id = $4`,
          [from, to, waiter?.id ?? null, product.id],
        )
      : await this.db.query(
          `SELECT COALESCE(SUM(o.total_amount), 0) AS total,
                  COUNT(*)                         AS order_count
             FROM orders o
            WHERE ${inRange}
              AND ${orderScope}`,
          [from, to, waiter?.id ?? null, null],
        );

    const items = await this.db.query(
      `SELECT COALESCE(SUM(oi.quantity), 0) AS item_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE ${inRange}
          AND ${orderScope}
          AND ($4::uuid IS NULL OR oi.product_id = $4)`,
      [from, to, waiter?.id ?? null, product?.id ?? null],
    );

    const cancelled = await this.db.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(o.total_amount), 0) AS total
         FROM orders o
        WHERE ${inRange}
          AND o.cancelled_at IS NOT NULL
          AND ($3::uuid IS NULL OR o.waiter_id = $3)`,
      [from, to, waiter?.id ?? null],
    );

    const byProduct = await this.db.query(
      `SELECT p.id, p.name, c.name AS category,
              SUM(oi.quantity)               AS qty_sold,
              SUM(oi.line_total)             AS revenue,
              COUNT(DISTINCT o.id)           AS order_count
         FROM order_items oi
         JOIN products   p ON p.id = oi.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         JOIN orders     o ON o.id = oi.order_id
        WHERE ${inRange}
          AND ${orderScope}
          AND ($4::uuid IS NULL OR oi.product_id = $4)
          AND ($5::text IS NULL OR p.name ILIKE $5 OR COALESCE(c.name, '') ILIKE $5)
        GROUP BY p.id, p.name, c.name
        ORDER BY revenue DESC`,
      [from, to, waiter?.id ?? null, product?.id ?? null, searchPattern],
    );

    // When a product is selected the waiter table shows that product's
    // numbers per waiter, so it stays consistent with the summary total.
    const byWaiter = product
      ? await this.db.query(
          `SELECT u.id, u.username, u.full_name,
                  COUNT(DISTINCT o.id)            AS order_count,
                  COALESCE(SUM(oi.line_total), 0) AS total,
                  COALESCE(SUM(oi.quantity), 0)   AS item_count
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN users  u ON u.id = o.waiter_id
            WHERE ${inRange}
              AND ${orderScope}
              AND oi.product_id = $4
              AND ($5::text IS NULL OR u.full_name ILIKE $5 OR u.username ILIKE $5)
            GROUP BY u.id, u.username, u.full_name
            ORDER BY total DESC`,
          [from, to, waiter?.id ?? null, product.id, searchPattern],
        )
      : await this.db.query(
          `SELECT w.id, w.username, w.full_name, w.order_count, w.total,
                  COALESCE(i.item_count, 0) AS item_count
             FROM (
               SELECT u.id, u.username, u.full_name,
                      COUNT(o.id)                      AS order_count,
                      COALESCE(SUM(o.total_amount), 0) AS total
                 FROM orders o
                 JOIN users u ON u.id = o.waiter_id
                WHERE ${inRange}
                  AND ${orderScope}
                  AND ($5::text IS NULL OR u.full_name ILIKE $5 OR u.username ILIKE $5)
                GROUP BY u.id, u.username, u.full_name
             ) w
             LEFT JOIN (
               SELECT o.waiter_id, SUM(oi.quantity) AS item_count
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                WHERE ${inRange}
                  AND o.cancelled_at IS NULL
                  AND ($3::uuid IS NULL OR o.waiter_id = $3)
                GROUP BY o.waiter_id
             ) i ON i.waiter_id = w.id
            ORDER BY w.total DESC`,
          [from, to, waiter?.id ?? null, null, searchPattern],
        );

    // Explicit grouping gives per-waiter day/week/month/year totals; without
    // one, long ranges fall back to months so the chart stays readable.
    const granularity: TrendGranularity = trendGranularity
      ?? (spanDays <= 31 ? 'day' : 'month');
    const localTs = `(o.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')`;
    const groupExpr = granularity === 'day'
      ? `to_char(${localTs}::date, 'YYYY-MM-DD')`
      : granularity === 'week'
        ? `to_char(date_trunc('week', ${localTs}), 'IYYY-"W"IW')`
        : granularity === 'month'
          ? `to_char(date_trunc('month', ${localTs}), 'YYYY-MM')`
          : `to_char(date_trunc('year', ${localTs}), 'YYYY')`;
    const orderExpr = granularity === 'day'
      ? `${localTs}::date`
      : granularity === 'week'
        ? `date_trunc('week', ${localTs})`
        : granularity === 'month'
          ? `date_trunc('month', ${localTs})`
          : `date_trunc('year', ${localTs})`;
    const trend = product
      ? await this.db.query(
          `SELECT ${groupExpr} AS period,
                  COUNT(DISTINCT o.id)            AS order_count,
                  COALESCE(SUM(oi.line_total), 0) AS total
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE ${inRange}
              AND ${orderScope}
              AND oi.product_id = $4
            GROUP BY ${orderExpr}
            ORDER BY ${orderExpr}`,
          [from, to, waiter?.id ?? null, product.id],
        )
      : await this.db.query(
          `SELECT ${groupExpr} AS period,
                  COUNT(*)                        AS order_count,
                  COALESCE(SUM(o.total_amount), 0) AS total
             FROM orders o
            WHERE ${inRange}
              AND ${orderScope}
            GROUP BY ${orderExpr}
            ORDER BY ${orderExpr}`,
          [from, to, waiter?.id ?? null, null],
        );

    const currencyRow = await this.db.query(
      `SELECT value FROM settings WHERE key = 'currency'`,
    );

    const totalSales = parseFloat(totals.rows[0].total);
    const orderCount = parseInt(totals.rows[0].order_count, 10);

    return {
      range: { from, to, days: spanDays },
      currency: currencyRow.rows[0]?.value ?? 'TZS',
      search: term || null,
      filters: {
        waiter: waiter
          ? { id: waiter.id, username: waiter.username, fullName: waiter.full_name }
          : null,
        product: product
          ? { id: product.id, name: product.name, category: product.category }
          : null,
      },
      summary: {
        totalSales: totals.rows[0].total,
        orderCount,
        avgOrderValue: orderCount > 0 ? (totalSales / orderCount).toFixed(2) : '0',
        itemCount: parseInt(items.rows[0].item_count, 10),
        cancelledCount: parseInt(cancelled.rows[0].n, 10),
        cancelledTotal: cancelled.rows[0].total,
      },
      byProduct: byProduct.rows,
      byWaiter: byWaiter.rows,
      trend: { granularity, rows: trend.rows },
    };
  }
}
