import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  async categories() {
    const r = await this.db.query(
      `SELECT id, name, sort_order, printer_station
         FROM categories
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC`,
    );
    return {
      categories: r.rows.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
        printerStation: c.printer_station,
      })),
    };
  }

  async products(authUser?: { role: string }) {
    // Cost price is margin data — only managers/admins may see it.
    const canSeeCost = !!authUser && ['MANAGER', 'ADMIN'].includes(authUser.role);
    // Sold-out products disappear from the ordering catalog, but managers
    // still need them listed in the Sold Out screen to switch them back on.
    const canSeeUnavailable = canSeeCost;
    const r = await this.db.query(
      `SELECT p.id, p.category_id, p.name, p.sku, p.selling_price, p.cost_price,
              c.name AS category_name, p.preparation_station,
              p.reorder_level, p.stock_managed, p.is_available,
              CASE WHEN p.stock_managed THEN
                COALESCE((SELECT SUM(quantity_change) FROM stock_movements
                           WHERE product_id = p.id), 0)
              - COALESCE((SELECT SUM(oi.quantity) FROM order_items oi
                            JOIN orders o ON o.id = oi.order_id
                           WHERE oi.product_id = p.id
                             AND o.cancelled_at IS NULL
                             AND o.closed_at   IS NULL), 0)
              ELSE NULL END AS available
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true
          AND (p.is_available = true OR $1)
        ORDER BY p.category_id ASC, p.name ASC`,
      [canSeeUnavailable],
    );
    return {
      products: r.rows.map((p) => ({
        id: p.id,
        categoryId: p.category_id,
        categoryName: p.category_name,
        name: p.name,
        sku: p.sku,
        sellingPrice: p.selling_price,
        costPrice: canSeeCost ? p.cost_price : undefined,
        preparationStation: p.preparation_station,
        reorderLevel: p.reorder_level,
        stockManaged: p.stock_managed,
        isAvailable: p.is_available,
        available: p.available === null ? null : Number(p.available),
      })),
    };
  }


  async createCategory(input: {
    name: string;
    sortOrder?: number;
    printerStation?: 'KITCHEN' | 'BAR' | 'NONE' | null;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Category name is required');
    if (name.length > 100) throw new BadRequestException('Category name too long');
    try {
      const r = await this.db.query(
        `INSERT INTO categories (name, sort_order, printer_station) VALUES ($1, $2, $3::"Station")
         RETURNING id, name, sort_order, printer_station, is_active`,
        [name, input.sortOrder ?? 0, input.printerStation ?? null],
      );
      const c = r.rows[0];
      return {
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
        printerStation: c.printer_station,
        isActive: c.is_active,
      };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'A category with that name already exists.' });
      }
      throw e;
    }
  }

  async updateCategory(id: string, input: {
    name?: string;
    sortOrder?: number;
    printerStation?: 'KITCHEN' | 'BAR' | 'NONE' | null;
  }) {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Category name cannot be empty');
      if (name.length > 100) throw new BadRequestException('Category name too long');
      sets.push(`name = $${i++}`); params.push(name);
    }
    if (input.sortOrder !== undefined) {
      sets.push(`sort_order = $${i++}`); params.push(input.sortOrder);
    }
    if (input.printerStation !== undefined) {
      sets.push(`printer_station = $${i++}::"Station"`); params.push(input.printerStation);
    }
    if (sets.length === 0) throw new BadRequestException('No fields to update');
    params.push(id);
    try {
      const r = await this.db.query(
        `UPDATE categories SET ${sets.join(', ')} WHERE id = $${i} AND is_active = true
         RETURNING id, name, sort_order, printer_station, is_active`,
        params,
      );
      if (!r.rows[0]) throw new NotFoundException('Category not found');
      const c = r.rows[0];
      return {
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
        printerStation: c.printer_station,
        isActive: c.is_active,
      };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'A category with that name already exists.' });
      }
      throw e;
    }
  }

  async deactivateCategory(id: string) {
    const cat = await this.db.query(
      `SELECT id, name FROM categories WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!cat.rows[0]) throw new NotFoundException('Category not found');

    const activeCount = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM products WHERE category_id = $1 AND is_active = true`,
      [id],
    );
    const n = parseInt(activeCount.rows[0].count, 10);
    if (n > 0) {
      throw new ConflictException({
        code: 'CATEGORY_IN_USE',
        message: `${n} active product${n === 1 ? '' : 's'} use this category. Reassign them first.`,
      });
    }
    await this.db.query(`UPDATE categories SET is_active = false WHERE id = $1`, [id]);
    return { id, isActive: false };
  }


  async createProduct(input: {
    name: string;
    sku?: string;
    categoryId: string;
    sellingPrice: number;
    costPrice?: number;
    preparationStation: string;
    stockManaged?: boolean;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Product name is required');

    const cat = await this.db.query(
      `SELECT id, is_active FROM categories WHERE id = $1`,
      [input.categoryId],
    );
    if (!cat.rows[0]) throw new BadRequestException('Category not found');
    if (!cat.rows[0].is_active) throw new BadRequestException('Category is inactive');

    // Same name in the same category makes stock rows and tickets ambiguous
    // (e.g. three products all called "Sato"). Require a distinguishing name.
    const duplicate = await this.db.query<{ id: string }>(
      `SELECT id FROM products
        WHERE category_id = $1 AND is_active = true AND lower(name) = lower($2)
        LIMIT 1`,
      [input.categoryId, name],
    );
    if (duplicate.rows[0]) {
      throw new ConflictException({
        code: 'DUPLICATE_PRODUCT_NAME',
        message: `"${name}" already exists in this category. Use a distinguishing name, e.g. "${name} beef".`,
      });
    }

    const sku = input.sku?.trim() || null;

    try {
      const r = await this.db.query(
        `INSERT INTO products (name, sku, category_id, selling_price, cost_price, preparation_station, stock_managed)
         VALUES ($1, $2, $3, $4, $5, $6::"Station", $7)
         RETURNING id, name, sku, category_id, selling_price, cost_price, preparation_station, is_active, reorder_level, stock_managed, is_available`,
        [name, sku, input.categoryId, input.sellingPrice, input.costPrice ?? 0, input.preparationStation, input.stockManaged ?? false],
      );
      const p = r.rows[0];
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        categoryId: p.category_id,
        sellingPrice: p.selling_price,
        costPrice: p.cost_price,
        preparationStation: p.preparation_station,
        isActive: p.is_active,
        reorderLevel: p.reorder_level,
        stockManaged: p.stock_managed,
        isAvailable: p.is_available,
      };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException({ code: 'DUPLICATE_SKU', message: 'A product with that SKU already exists.' });
      }
      throw e;
    }
  }

  async updateProduct(id: string, input: {
    name?: string;
    sku?: string;
    categoryId?: string;
    sellingPrice?: number;
    costPrice?: number;
    preparationStation?: string;
    reorderLevel?: number;
    stockManaged?: boolean;
    isAvailable?: boolean;
  }) {
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Product name cannot be empty');
      sets.push(`name = $${i++}`); params.push(name);
    }
    if (input.sku !== undefined) {
      const sku = input.sku.trim() || null;
      sets.push(`sku = $${i++}`); params.push(sku);
    }
    if (input.categoryId !== undefined) {
      const cat = await this.db.query(
        `SELECT id, is_active FROM categories WHERE id = $1`,
        [input.categoryId],
      );
      if (!cat.rows[0]) throw new BadRequestException('Category not found');
      if (!cat.rows[0].is_active) throw new BadRequestException('Category is inactive');
      sets.push(`category_id = $${i++}`); params.push(input.categoryId);
    }
    if (input.sellingPrice !== undefined) {
      sets.push(`selling_price = $${i++}`); params.push(input.sellingPrice);
    }
    if (input.costPrice !== undefined) {
      sets.push(`cost_price = $${i++}`); params.push(input.costPrice);
    }
    if (input.preparationStation !== undefined) {
      sets.push(`preparation_station = $${i++}::"Station"`); params.push(input.preparationStation);
    }
    if (input.reorderLevel !== undefined) {
      sets.push(`reorder_level = $${i++}`); params.push(input.reorderLevel);
    }
    if (input.stockManaged !== undefined) {
      sets.push(`stock_managed = $${i++}`); params.push(input.stockManaged);
    }
    if (input.isAvailable !== undefined) {
      sets.push(`is_available = $${i++}`); params.push(input.isAvailable);
    }

    if (sets.length === 0) throw new BadRequestException('No fields to update');

    if (input.name !== undefined || input.categoryId !== undefined) {
      const cur = await this.db.query<{ name: string; category_id: string }>(
        `SELECT name, category_id FROM products WHERE id = $1 AND is_active = true`,
        [id],
      );
      if (!cur.rows[0]) throw new NotFoundException('Product not found');
      const nextName = (input.name ?? cur.rows[0].name).trim();
      const nextCategory = input.categoryId ?? cur.rows[0].category_id;
      const duplicate = await this.db.query<{ id: string }>(
        `SELECT id FROM products
          WHERE category_id = $1 AND is_active = true
            AND lower(name) = lower($2) AND id <> $3
          LIMIT 1`,
        [nextCategory, nextName, id],
      );
      if (duplicate.rows[0]) {
        throw new ConflictException({
          code: 'DUPLICATE_PRODUCT_NAME',
          message: `"${nextName}" already exists in this category. Use a distinguishing name, e.g. "${nextName} beef".`,
        });
      }
    }

    sets.push(`updated_at = now()`);
    params.push(id);

    try {
      const r = await this.db.query(
        `UPDATE products SET ${sets.join(', ')} WHERE id = $${i} AND is_active = true
         RETURNING id, name, sku, category_id, selling_price, cost_price, preparation_station, is_active, reorder_level, stock_managed, is_available`,
        params,
      );
      if (!r.rows[0]) throw new NotFoundException('Product not found');
      const p = r.rows[0];
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        categoryId: p.category_id,
        sellingPrice: p.selling_price,
        costPrice: p.cost_price,
        preparationStation: p.preparation_station,
        isActive: p.is_active,
        reorderLevel: p.reorder_level,
        stockManaged: p.stock_managed,
        isAvailable: p.is_available,
      };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException({ code: 'DUPLICATE_SKU', message: 'A product with that SKU already exists.' });
      }
      throw e;
    }
  }

  async deactivateProduct(id: string) {
    const r = await this.db.query(
      `UPDATE products SET is_active = false, updated_at = now()
        WHERE id = $1 AND is_active = true
        RETURNING id`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundException('Product not found');
    return { id, isActive: false };
  }
}
