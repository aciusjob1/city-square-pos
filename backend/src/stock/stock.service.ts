import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

export type StockStatus = 'OK' | 'LOW' | 'OUT';

export interface AvailabilityCheckItem {
  productId: string;
  quantity: number;
  stockManaged: boolean;
}

export interface InsufficientStockItem {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

function computeStatus(balance: number, reorderLevel: number): StockStatus {
  if (balance <= 0) return 'OUT';
  if (reorderLevel > 0 && balance < reorderLevel) return 'LOW';
  return 'OK';
}

@Injectable()
export class StockService {
  constructor(private readonly db: DatabaseService) {}

  async balances() {
    const r = await this.db.query(
      `SELECT p.id AS product_id, p.name AS product_name, p.reorder_level,
              COALESCE(SUM(sm.quantity_change), 0)::int AS balance
         FROM products p
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE p.is_active = true AND p.stock_managed = true
     GROUP BY p.id, p.name, p.reorder_level
     ORDER BY p.name ASC`,
    );
    return {
      balances: r.rows.map((row: any) => ({
        productId: row.product_id,
        productName: row.product_name,
        balance: Number(row.balance),
        reorderLevel: row.reorder_level,
        status: computeStatus(Number(row.balance), row.reorder_level),
      })),
    };
  }

  async lowStock() {
    const r = await this.db.query(
      `SELECT p.id AS product_id, p.name AS product_name, p.reorder_level,
              COALESCE(SUM(sm.quantity_change), 0)::int AS balance
         FROM products p
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE p.is_active = true AND p.stock_managed = true
     GROUP BY p.id, p.name, p.reorder_level
       HAVING p.reorder_level > 0
          AND COALESCE(SUM(sm.quantity_change), 0) < p.reorder_level
     ORDER BY p.name ASC`,
    );
    return {
      products: r.rows.map((row: any) => ({
        productId: row.product_id,
        productName: row.product_name,
        balance: Number(row.balance),
        reorderLevel: row.reorder_level,
      })),
    };
  }

  async restock(productId: string, quantity: number, notes: string | null, actor: AuthUser) {
    const p = await this.db.query(
      `SELECT id, name FROM products WHERE id = $1 AND is_active = true`,
      [productId],
    );
    if (!p.rows[0]) throw new NotFoundException('Product not found or inactive');

    await this.db.query(
      `INSERT INTO stock_movements
         (product_id, quantity_change, reason, recorded_by_id, notes)
       VALUES ($1, $2, 'PURCHASE'::"StockMovementReason", $3, $4)`,
      [productId, quantity, actor.userId, notes],
    );

    return { ok: true };
  }

  /**
   * Reservation-aware availability check.
   *
   * available(p) = SUM(stock_movements.quantity_change for p)
   *              - SUM(order_items.quantity for p
   *                    where order.cancelled_at IS NULL
   *                      and order.closed_at    IS NULL)
   *
   * Throws BadRequestException INSUFFICIENT_STOCK if any aggregated
   * requested quantity exceeds available, and STOCK_CHECK_INCOMPLETE
   * if any requested managed product is absent from the result.
   *
   * Advisory locks are transaction-scoped; the caller must invoke this
   * inside the same db.transaction that will insert order rows.
   */
  async checkAvailabilityForOrder(
    client: { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> },
    items: AvailabilityCheckItem[],
  ): Promise<void> {
    const agg = new Map<string, number>();
    for (const it of items) {
      if (!it.stockManaged || it.quantity <= 0) continue;
      agg.set(it.productId, (agg.get(it.productId) ?? 0) + it.quantity);
    }
    if (agg.size === 0) return;

    const ids = [...agg.keys()].sort();

    for (const id of ids) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [id],
      );
    }

    const r = await client.query<{
      id: string;
      name: string;
      physical: string;
      reserved: string;
    }>(
      `SELECT p.id,
              p.name,
              COALESCE(phys.balance, 0)::text AS physical,
              COALESCE(res.reserved, 0)::text AS reserved
         FROM products p
         LEFT JOIN (
           SELECT product_id, SUM(quantity_change) AS balance
             FROM stock_movements
            WHERE product_id = ANY($1::uuid[])
            GROUP BY product_id
         ) phys ON phys.product_id = p.id
         LEFT JOIN (
           SELECT oi.product_id, SUM(oi.quantity) AS reserved
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE oi.product_id = ANY($1::uuid[])
              AND o.cancelled_at IS NULL
              AND o.closed_at    IS NULL
            GROUP BY oi.product_id
         ) res ON res.product_id = p.id
        WHERE p.id = ANY($1::uuid[])`,
      [ids],
    );

    const seen = new Set(r.rows.map((row) => row.id));
    const missing = ids.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'STOCK_CHECK_INCOMPLETE',
        message:
          'One or more products could not be evaluated for stock. Order was not processed.',
        missingProductIds: missing,
      });
    }

    const insufficient: InsufficientStockItem[] = [];
    for (const row of r.rows) {
      const requested = agg.get(row.id);
      if (requested === undefined) {
        throw new BadRequestException({
          code: 'STOCK_CHECK_INCOMPLETE',
          message:
            'Stock check did not produce a requested quantity. Order was not processed.',
          missingProductIds: [row.id],
        });
      }
      const available = Number(row.physical) - Number(row.reserved);
      if (requested > available) {
        insufficient.push({
          productId: row.id,
          productName: row.name,
          requested,
          available,
        });
      }
    }

    if (insufficient.length > 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Insufficient stock for one or more products.',
        insufficientItems: insufficient,
      });
    }
  }
}
