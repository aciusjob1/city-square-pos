import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  async categories() {
    const r = await this.db.query(
      `SELECT id, name, sort_order
         FROM categories
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC`,
    );
    return {
      categories: r.rows.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
      })),
    };
  }

  async products() {
    const r = await this.db.query(
      `SELECT id, category_id, name, sku, selling_price, cost_price, preparation_station, reorder_level
         FROM products
        WHERE is_active = true
        ORDER BY category_id ASC, name ASC`,
    );
    return {
      products: r.rows.map((p) => ({
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        sku: p.sku,
        sellingPrice: p.selling_price,
        costPrice: p.cost_price,
        preparationStation: p.preparation_station,
        reorderLevel: p.reorder_level,
      })),
    };
  }


  async createCategory(input: { name: string; sortOrder?: number }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Category name is required');
    if (name.length > 100) throw new BadRequestException('Category name too long');
    try {
      const r = await this.db.query(
        `INSERT INTO categories (name, sort_order) VALUES ($1, $2)
         RETURNING id, name, sort_order, is_active`,
        [name, input.sortOrder ?? 0],
      );
      const c = r.rows[0];
      return { id: c.id, name: c.name, sortOrder: c.sort_order, isActive: c.is_active };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'A category with that name already exists.' });
      }
      throw e;
    }
  }

  async updateCategory(id: string, input: { name?: string; sortOrder?: number }) {
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
    if (sets.length === 0) throw new BadRequestException('No fields to update');
    params.push(id);
    try {
      const r = await this.db.query(
        `UPDATE categories SET ${sets.join(', ')} WHERE id = $${i} AND is_active = true
         RETURNING id, name, sort_order, is_active`,
        params,
      );
      if (!r.rows[0]) throw new NotFoundException('Category not found');
      const c = r.rows[0];
      return { id: c.id, name: c.name, sortOrder: c.sort_order, isActive: c.is_active };
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
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Product name is required');

    const cat = await this.db.query(
      `SELECT id, is_active FROM categories WHERE id = $1`,
      [input.categoryId],
    );
    if (!cat.rows[0]) throw new BadRequestException('Category not found');
    if (!cat.rows[0].is_active) throw new BadRequestException('Category is inactive');

    const sku = input.sku?.trim() || null;

    try {
      const r = await this.db.query(
        `INSERT INTO products (name, sku, category_id, selling_price, cost_price, preparation_station)
         VALUES ($1, $2, $3, $4, $5, $6::"Station")
         RETURNING id, name, sku, category_id, selling_price, cost_price, preparation_station, is_active`,
        [name, sku, input.categoryId, input.sellingPrice, input.costPrice ?? 0, input.preparationStation],
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

    if (sets.length === 0) throw new BadRequestException('No fields to update');
    sets.push(`updated_at = now()`);
    params.push(id);

    try {
      const r = await this.db.query(
        `UPDATE products SET ${sets.join(', ')} WHERE id = $${i} AND is_active = true
         RETURNING id, name, sku, category_id, selling_price, cost_price, preparation_station, is_active`,
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
