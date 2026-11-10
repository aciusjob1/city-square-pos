import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PatchSettingsDto } from './dto/patch-settings.dto';

const EDITABLE_KEYS = new Set([
  'restaurant_name',
  'currency',
  'printer.default.kitchen',
  'printer.default.bar',
  'printer.default.receipt',
]);

const READABLE_KEYS = new Set([...EDITABLE_KEYS, 'timezone']);

const STATION_FOR_KEY: Record<string, string> = {
  'printer.default.kitchen': 'KITCHEN',
  'printer.default.bar': 'BAR',
  'printer.default.receipt': 'NONE',
};

@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const r = await this.db.query(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key`,
      [Array.from(READABLE_KEYS)],
    );
    const map: Record<string, any> = {};
    for (const row of r.rows) map[row.key] = row.value;
    return {
      settings: {
        restaurantName: map['restaurant_name'] ?? '',
        currency: map['currency'] ?? 'TZS',
        timezone: map['timezone'] ?? 'Africa/Dar_es_Salaam',
        printerDefaults: {
          kitchen: map['printer.default.kitchen'] ?? null,
          bar: map['printer.default.bar'] ?? null,
          receipt: map['printer.default.receipt'] ?? null,
        },
      },
    };
  }

  async patch(dto: PatchSettingsDto) {
    // 1. Reject unknown keys
    for (const key of Object.keys(dto)) {
      if (!EDITABLE_KEYS.has(key)) {
        throw new BadRequestException(`Setting '${key}' is not editable`);
      }
    }

    // 2. Filter out undefined values (fields not sent by client).
    //    Keep explicit null — that's how you clear a printer default.
    const entries = Object.entries(dto).filter(([_, val]) => val !== undefined);
    if (entries.length === 0) {
      throw new BadRequestException('No fields to update');
    }

    // 3. Validate printer defaults before opening the transaction
    for (const [key, val] of entries) {
      if (key.startsWith('printer.default.') && val !== null) {
        const expectedStation = STATION_FOR_KEY[key];
        const r = await this.db.query(
          `SELECT id, station FROM printers WHERE id = $1 AND is_active = true`,
          [val],
        );
        if (!r.rows[0]) {
          throw new BadRequestException(`Printer not found or inactive for ${key}`);
        }
        if (r.rows[0].station !== expectedStation) {
          throw new BadRequestException(
            `Printer station mismatch for ${key}: expected ${expectedStation}, got ${r.rows[0].station}`,
          );
        }
      }
    }

    // 4. Write all keys atomically
    await this.db.transaction(async (client) => {
      for (const [key, val] of entries) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, JSON.stringify(val)],
        );
      }
    });

    return { ok: true };
  }
}
