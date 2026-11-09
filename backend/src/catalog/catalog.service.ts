import { Injectable } from '@nestjs/common';
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
}
