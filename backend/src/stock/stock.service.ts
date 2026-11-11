import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

export type StockStatus = 'OK' | 'LOW' | 'OUT';

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
        WHERE p.is_active = true
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
        WHERE p.is_active = true
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
}
