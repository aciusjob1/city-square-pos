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
      `SELECT id, category_id, name, sku, selling_price, preparation_station
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
        preparationStation: p.preparation_station,
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
}
