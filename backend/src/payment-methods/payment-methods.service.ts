import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const r = await this.db.query(
      `SELECT id, code, name FROM payment_methods
        WHERE is_active = true
        ORDER BY name ASC`,
    );
    return { paymentMethods: r.rows };
  }
}
