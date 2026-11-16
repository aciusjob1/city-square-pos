import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

export type StockStatus = 'OK' | 'LOW' | 'OUT' | 'UNTRACKED';
export type PoolUnit = 'G' | 'ML' | 'PIECES';

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

export interface InsufficientPoolItem {
  poolId: string;
  poolName: string;
  unit: string;
  requested: number;
  available: number;
}

export interface PoolBalanceRow {
  id: string;
  name: string;
  unit: PoolUnit;
  reorderLevel: number;
  physical: number;
  reserved: number;
  available: number;
  status: StockStatus;
  productCount: number;
}

function computeStatus(balance: number, reorderLevel: number): StockStatus {
  if (balance <= 0) return 'OUT';
  if (reorderLevel > 0 && balance < reorderLevel) return 'LOW';
  return 'OK';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Piece-counted pools (e.g. "10 Sato in the fridge") only make sense in whole
// units, so fractional amounts are rejected instead of silently rounding.
function assertWholeCount(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestException({
      code: 'POOL_INTEGER_REQUIRED',
      message: `${label} must be a whole number for a piece-counted pool.`,
    });
  }
}

@Injectable()
export class StockService {
  constructor(private readonly db: DatabaseService) {}

  async balances() {
    const r = await this.db.query(
      `SELECT p.id AS product_id, p.name AS product_name, p.sku,
              c.name AS category_name, p.reorder_level, p.is_available,
              COALESCE(SUM(sm.quantity_change), 0)::int AS balance
         FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE p.is_active = true AND p.stock_managed = true
     GROUP BY p.id, p.name, p.sku, c.name, p.reorder_level, p.is_available
     ORDER BY p.name ASC`,
    );
    return {
      balances: r.rows.map((row: any) => ({
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        categoryName: row.category_name,
        balance: Number(row.balance),
        reorderLevel: row.reorder_level,
        status: computeStatus(Number(row.balance), row.reorder_level),
        isAvailable: row.is_available,
      })),
    };
  }

  /**
   * One row per active product combining the manual sold-out switch with the
   * stock that actually limits it (per-dish balance and shared pools).
   */
  async availability() {
    const products = await this.db.query(
      `SELECT id, name, is_available, stock_managed, reorder_level
         FROM products
        WHERE is_active = true
     ORDER BY name ASC`,
    );
    const { balances } = await this.balances();
    const balanceById = new Map<string, (typeof balances)[number]>();
    for (const b of balances) balanceById.set(b.productId, b);
    const { pools } = await this.pools();
    const poolById = new Map<string, (typeof pools)[number]>();
    for (const p of pools) poolById.set(p.id, p);
    const recipes = await this.db.query(
      `SELECT menu_product_id, stock_item_id, quantity_per_unit FROM stock_recipes`,
    );
    const recipesByProduct = new Map<
      string, Array<{ poolId: string; perPlate: number }>
    >();
    for (const row of recipes.rows) {
      const list = recipesByProduct.get(row.menu_product_id) ?? [];
      list.push({
        poolId: row.stock_item_id,
        perPlate: Number(row.quantity_per_unit),
      });
      recipesByProduct.set(row.menu_product_id, list);
    }

    return {
      products: products.rows.map((row: any) => {
        const bal = balanceById.get(row.id);
        const balance = row.stock_managed ? Number(bal?.balance ?? 0) : null;
        const limits = (recipesByProduct.get(row.id) ?? []).map((recipe) => {
          // An inactive pool holds no sellable stock.
          const pool = poolById.get(recipe.poolId);
          const available = pool ? Math.max(0, pool.available) : 0;
          return {
            pool,
            platesLeft: Math.floor(available / recipe.perPlate),
            available,
            perPlate: recipe.perPlate,
          };
        });
        const platesLeft = limits.length
          ? Math.min(...limits.map((l) => l.platesLeft))
          : null;
        const limiting = limits.find((l) => l.platesLeft === platesLeft) ?? null;

        const directOut = row.stock_managed && (balance ?? 0) <= 0;
        const poolOut = platesLeft !== null && platesLeft <= 0;
        const low = row.stock_managed
          && row.reorder_level > 0
          && (balance ?? 0) < row.reorder_level;

        const status: StockStatus = directOut || poolOut
          ? 'OUT'
          : low
            ? 'LOW'
            : row.stock_managed || platesLeft !== null
              ? 'OK'
              : 'UNTRACKED';

        return {
          productId: row.id,
          productName: row.name,
          isAvailable: row.is_available,
          stockManaged: row.stock_managed,
          balance,
          reorderLevel: row.reorder_level,
          status,
          platesLeft,
          limitedByPool: limiting?.pool
            ? {
                id: limiting.pool.id,
                name: limiting.pool.name,
                unit: limiting.pool.unit,
                available: limiting.available,
                platesLeft: limiting.platesLeft,
              }
            : null,
        };
      }),
    };
  }

  async lowStock() {
    const r = await this.db.query(
      `SELECT p.id AS product_id, p.name AS product_name, p.sku,
              c.name AS category_name, p.reorder_level,
              COALESCE(SUM(sm.quantity_change), 0)::int AS balance
         FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
        WHERE p.is_active = true AND p.stock_managed = true
     GROUP BY p.id, p.name, p.sku, c.name, p.reorder_level
       HAVING p.reorder_level > 0
          AND COALESCE(SUM(sm.quantity_change), 0) < p.reorder_level
     ORDER BY p.name ASC`,
    );
    return {
      products: r.rows.map((row: any) => ({
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        categoryName: row.category_name,
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

  // ------------------------------------------------------------------
  // Ingredient pools (stock_items) — shared raw stock behind recipes
  // ------------------------------------------------------------------

  async pools(): Promise<{ pools: PoolBalanceRow[] }> {
    const r = await this.db.query(
      `SELECT si.id, si.name, si.base_unit, si.reorder_level,
              COALESCE(phys.physical, 0) AS physical,
              COALESCE(res.reserved, 0) AS reserved,
              (SELECT COUNT(*)::int FROM stock_recipes sr
                WHERE sr.stock_item_id = si.id) AS product_count
         FROM stock_items si
    LEFT JOIN (
           SELECT stock_item_id, SUM(quantity_change) AS physical
             FROM stock_movements
            WHERE stock_item_id IS NOT NULL
            GROUP BY stock_item_id
         ) phys ON phys.stock_item_id = si.id
    LEFT JOIN (
           SELECT sr.stock_item_id,
                  SUM(oi.quantity * sr.quantity_per_unit) AS reserved
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
                         AND o.cancelled_at IS NULL
                         AND o.closed_at IS NULL
             JOIN stock_recipes sr ON sr.menu_product_id = oi.product_id
            GROUP BY sr.stock_item_id
         ) res ON res.stock_item_id = si.id
        WHERE si.is_active = true
     ORDER BY si.name ASC`,
    );

    return {
      pools: r.rows.map((row: any) => {
        const physical = round2(Number(row.physical));
        const reserved = round2(Number(row.reserved));
        const available = round2(physical - reserved);
        return {
          id: row.id,
          name: row.name,
          unit: row.base_unit,
          reorderLevel: Number(row.reorder_level),
          physical,
          reserved,
          available,
          status: computeStatus(available, Number(row.reorder_level)),
          productCount: Number(row.product_count),
        };
      }),
    };
  }

  async createPool(input: {
    name: string; unit: PoolUnit; reorderLevel?: number;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Pool name is required');
    if (input.unit === 'PIECES' && input.reorderLevel !== undefined) {
      assertWholeCount(input.reorderLevel, 'Reorder level');
    }
    try {
      const r = await this.db.query(
        `INSERT INTO stock_items (name, base_unit, reorder_level)
         VALUES ($1, $2, $3)
         RETURNING id, name, base_unit, reorder_level`,
        [name, input.unit, input.reorderLevel ?? 0],
      );
      const row = r.rows[0];
      return {
        id: row.id,
        name: row.name,
        unit: row.base_unit,
        reorderLevel: Number(row.reorder_level),
      };
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException({
          code: 'DUPLICATE_POOL_NAME',
          message: `A pool named "${name}" already exists.`,
        });
      }
      throw err;
    }
  }

  async updatePool(poolId: string, patch: {
    name?: string; unit?: PoolUnit; reorderLevel?: number; isActive?: boolean;
  }) {
    const cur = await this.db.query(
      `SELECT id, name, base_unit, is_active FROM stock_items WHERE id = $1`,
      [poolId],
    );
    if (!cur.rows[0]) throw new NotFoundException('Pool not found');
    const pool = cur.rows[0];

    if (patch.unit && patch.unit !== pool.base_unit) {
      const used = await this.db.query(
        `SELECT 1 FROM stock_movements WHERE stock_item_id = $1 LIMIT 1`,
        [poolId],
      );
      if (used.rows[0]) {
        throw new BadRequestException({
          code: 'POOL_UNIT_LOCKED',
          message: 'The unit cannot change after stock has been recorded for this pool.',
        });
      }
    }

    const effectiveUnit = patch.unit ?? pool.base_unit;
    if (effectiveUnit === 'PIECES' && patch.reorderLevel !== undefined) {
      assertWholeCount(patch.reorderLevel, 'Reorder level');
    }

    const name = patch.name !== undefined ? patch.name.trim() : null;
    if (name !== null && !name) throw new BadRequestException('Pool name is required');
    try {
      await this.db.query(
        `UPDATE stock_items
            SET name = COALESCE($2, name),
                base_unit = COALESCE($3, base_unit),
                reorder_level = COALESCE($4, reorder_level),
                is_active = COALESCE($5, is_active),
                updated_at = now()
          WHERE id = $1`,
        [
          poolId,
          name,
          patch.unit ?? null,
          patch.reorderLevel ?? null,
          patch.isActive ?? null,
        ],
      );
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException({
          code: 'DUPLICATE_POOL_NAME',
          message: `A pool named "${name}" already exists.`,
        });
      }
      throw err;
    }
    return { ok: true };
  }

  async restockPool(
    poolId: string, quantity: number, notes: string | null, actor: AuthUser,
  ) {
    const p = await this.db.query(
      `SELECT id, base_unit FROM stock_items WHERE id = $1 AND is_active = true`,
      [poolId],
    );
    if (!p.rows[0]) throw new NotFoundException('Pool not found or inactive');

    const qty = round2(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('Quantity must be a positive number');
    }
    if (p.rows[0].base_unit === 'PIECES') {
      assertWholeCount(qty, 'Quantity');
    }

    await this.db.query(
      `INSERT INTO stock_movements
         (stock_item_id, quantity_change, reason, recorded_by_id, notes, unit)
       VALUES ($1, $2, 'PURCHASE'::"StockMovementReason", $3, $4, $5)`,
      [poolId, qty, actor.userId, notes, p.rows[0].base_unit],
    );

    return { ok: true };
  }

  async poolRecipes(poolId: string) {
    const p = await this.db.query(
      `SELECT id, name, base_unit FROM stock_items WHERE id = $1`,
      [poolId],
    );
    if (!p.rows[0]) throw new NotFoundException('Pool not found');
    const r = await this.db.query(
      `SELECT sr.menu_product_id, sr.quantity_per_unit,
              pr.name AS product_name, pr.sku, c.name AS category_name
         FROM stock_recipes sr
         JOIN products pr ON pr.id = sr.menu_product_id
    LEFT JOIN categories c ON c.id = pr.category_id
        WHERE sr.stock_item_id = $1
     ORDER BY pr.name ASC`,
      [poolId],
    );
    return {
      pool: { id: p.rows[0].id, name: p.rows[0].name, unit: p.rows[0].base_unit },
      recipes: r.rows.map((row: any) => ({
        productId: row.menu_product_id,
        productName: row.product_name,
        sku: row.sku,
        categoryName: row.category_name,
        quantityPerUnit: Number(row.quantity_per_unit),
      })),
    };
  }

  async upsertPoolRecipe(
    poolId: string, productId: string, quantityPerUnit: number,
  ) {
    const pool = await this.db.query(
      `SELECT id, base_unit FROM stock_items WHERE id = $1 AND is_active = true`,
      [poolId],
    );
    if (!pool.rows[0]) throw new NotFoundException('Pool not found or inactive');
    const product = await this.db.query(
      `SELECT id FROM products WHERE id = $1 AND is_active = true`,
      [productId],
    );
    if (!product.rows[0]) throw new NotFoundException('Product not found or inactive');

    const qty = round2(quantityPerUnit);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('Quantity per unit must be a positive number');
    }
    // Piece pools are stocked in whole pieces, but a dish may use a fraction
    // of one (a quarter chicken, half a loaf), so recipes keep decimals.

    await this.db.query(
      `INSERT INTO stock_recipes (menu_product_id, stock_item_id, quantity_per_unit)
       VALUES ($1, $2, $3)
       ON CONFLICT (menu_product_id, stock_item_id)
       DO UPDATE SET quantity_per_unit = EXCLUDED.quantity_per_unit, updated_at = now()`,
      [productId, poolId, qty],
    );
    return { ok: true };
  }

  async removePoolRecipe(poolId: string, productId: string) {
    await this.db.query(
      `DELETE FROM stock_recipes
        WHERE stock_item_id = $1 AND menu_product_id = $2`,
      [poolId, productId],
    );
    return { ok: true };
  }

  /**
   * Deducts pool stock for every recipe line on a paid order.
   *
   * Runs inside the payment transaction. The partial unique index on
   * (reference_order_item_id, stock_item_id) makes bill retries and
   * double-settles idempotent.
   */
  async consumePoolsForOrder(
    client: PoolClient, orderId: string, actorId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO stock_movements
         (stock_item_id, quantity_change, reason, reference_order_id,
          reference_order_item_id, recorded_by_id, notes, unit)
       SELECT sr.stock_item_id,
              ROUND(-(oi.quantity * sr.quantity_per_unit), 2),
              'SALE'::"StockMovementReason",
              oi.order_id, oi.id, $2::uuid,
              'Order ' || o.order_number, si.base_unit
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN stock_recipes sr ON sr.menu_product_id = oi.product_id
         JOIN stock_items si ON si.id = sr.stock_item_id
        WHERE oi.order_id = $1
          AND oi.quantity * sr.quantity_per_unit > 0
       ON CONFLICT (reference_order_item_id, stock_item_id)
         WHERE reference_order_item_id IS NOT NULL
           AND stock_item_id IS NOT NULL
           AND reason = 'SALE'
       DO NOTHING`,
      [orderId, actorId],
    );
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
    if (agg.size === 0) {
      // Dish-level tracking can be off while the dish still draws from a
      // shared pool, so the pool check must not be skipped here.
      await this.checkPoolAvailability(client, items);
      return;
    }

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

    await this.checkPoolAvailability(client, items);
  }

  /**
   * Shared raw stock: every product linked to a pool through stock_recipes
   * consumes (quantity × quantity_per_unit) from it. Open orders already
   * hold reservations, so the caller only asks about the new quantities.
   */
  private async checkPoolAvailability(
    client: { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> },
    items: AvailabilityCheckItem[],
  ): Promise<void> {
    const perProduct = new Map<string, number>();
    for (const it of items) {
      if (it.quantity <= 0) continue;
      perProduct.set(it.productId, (perProduct.get(it.productId) ?? 0) + it.quantity);
    }
    if (perProduct.size === 0) return;

    const productIds = [...perProduct.keys()];
    const recipeRes = await client.query<{
      menu_product_id: string;
      stock_item_id: string;
      quantity_per_unit: string;
      name: string;
      base_unit: string;
      is_active: boolean;
    }>(
      `SELECT sr.menu_product_id, sr.stock_item_id, sr.quantity_per_unit,
              si.name, si.base_unit, si.is_active
         FROM stock_recipes sr
         JOIN stock_items si ON si.id = sr.stock_item_id
        WHERE sr.menu_product_id = ANY($1::uuid[])`,
      [productIds],
    );
    if (recipeRes.rows.length === 0) return;

    const poolIds = Array.from(new Set(recipeRes.rows.map((r) => r.stock_item_id))).sort();
    for (const id of poolIds) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('pool:' || $1::text, 0))`,
        [id],
      );
    }

    const requested = new Map<string, number>();
    for (const row of recipeRes.rows) {
      const qty = perProduct.get(row.menu_product_id) ?? 0;
      if (qty <= 0) continue;
      const add = qty * Number(row.quantity_per_unit);
      requested.set(row.stock_item_id, round2((requested.get(row.stock_item_id) ?? 0) + add));
    }
    if (requested.size === 0) return;

    const stockRes = await client.query<{
      id: string;
      physical: string;
      reserved: string;
    }>(
      `SELECT si.id,
              COALESCE(phys.physical, 0)::text AS physical,
              COALESCE(res.reserved, 0)::text AS reserved
         FROM stock_items si
    LEFT JOIN (
           SELECT stock_item_id, SUM(quantity_change) AS physical
             FROM stock_movements
            WHERE stock_item_id = ANY($1::uuid[])
            GROUP BY stock_item_id
         ) phys ON phys.stock_item_id = si.id
    LEFT JOIN (
           SELECT sr.stock_item_id,
                  SUM(oi.quantity * sr.quantity_per_unit) AS reserved
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
                         AND o.cancelled_at IS NULL
                         AND o.closed_at IS NULL
             JOIN stock_recipes sr ON sr.menu_product_id = oi.product_id
            WHERE sr.stock_item_id = ANY($1::uuid[])
            GROUP BY sr.stock_item_id
         ) res ON res.stock_item_id = si.id
        WHERE si.id = ANY($1::uuid[])`,
      [poolIds],
    );

    const balances = new Map(stockRes.rows.map((r) => [r.id, r]));
    const meta = new Map(
      recipeRes.rows.map((r) => [
        r.stock_item_id,
        { name: r.name, unit: r.base_unit, isActive: r.is_active },
      ]),
    );

    const insufficientPools: InsufficientPoolItem[] = [];
    for (const [poolId, want] of requested) {
      const bal = balances.get(poolId);
      const info = meta.get(poolId);
      const available = bal && info?.isActive !== false
        ? round2(Number(bal.physical) - Number(bal.reserved))
        : 0;
      if (want > available) {
        insufficientPools.push({
          poolId,
          poolName: info?.name ?? 'Unknown pool',
          unit: info?.unit ?? '',
          requested: round2(want),
          available,
        });
      }
    }

    if (insufficientPools.length > 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_POOL_STOCK',
        message: 'Insufficient raw stock for one or more ingredients.',
        insufficientPools,
      });
    }
  }
}
