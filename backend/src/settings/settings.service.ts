import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NetworkService } from '../network/network.module';
import { PatchSettingsDto } from './dto/patch-settings.dto';

const EDITABLE_KEYS = new Set([
  'restaurant_name',
  'restaurant_logo',
  'currency',
  'printer.default.kitchen',
  'printer.default.bar',
  'printer.default.receipt',
  'day.rollover_mode',
  'network_access',
]);

const READABLE_KEYS = new Set([...EDITABLE_KEYS, 'timezone']);

const STATION_FOR_KEY: Record<string, string> = {
  'printer.default.kitchen': 'KITCHEN',
  'printer.default.bar': 'BAR',
  'printer.default.receipt': 'NONE',
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly network: NetworkService,
  ) {}

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
        restaurantLogo: map['restaurant_logo'] ?? null,
        currency: map['currency'] ?? 'TZS',
        timezone: map['timezone'] ?? 'Africa/Dar_es_Salaam',
        printerDefaults: {
          kitchen: map['printer.default.kitchen'] ?? null,
          bar: map['printer.default.bar'] ?? null,
          receipt: map['printer.default.receipt'] ?? null,
        },
        dayRolloverMode: map['day.rollover_mode'] === 'AUTO' ? 'AUTO' : 'MANUAL',
        networkAccess: map['network_access'] === 'WIRED' ? 'WIRED' : 'ALL',
      },
      network: this.network.status(),
    };
  }

  async branding() {
    const r = await this.db.query(
      `SELECT key, value FROM settings
        WHERE key IN ('restaurant_name', 'restaurant_logo', 'currency')`,
    );
    const map: Record<string, any> = {};
    for (const row of r.rows) map[row.key] = row.value;
    const name = typeof map['restaurant_name'] === 'string'
      ? map['restaurant_name'].trim()
      : '';
    return {
      restaurantName: name || 'City Square',
      restaurantLogo: typeof map['restaurant_logo'] === 'string'
        ? map['restaurant_logo']
        : null,
      currency: map['currency'] ?? 'TZS',
    };
  }

  async patch(dto: PatchSettingsDto) {
    // 1. Reject unknown keys
    for (const key of Object.keys(dto)) {
      if (!EDITABLE_KEYS.has(key)) {
        throw new BadRequestException(`Setting '${key}' is not editable`);
      }
    }

    // 2. Reject malformed logos before they reach the database.
    const logo = (dto as any).restaurant_logo;
    if (logo !== undefined && logo !== null) {
      if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(logo)) {
        throw new BadRequestException('Logo must be a base64 image data URL');
      }
      if (logo.length > 800_000) {
        throw new BadRequestException('Logo is too large (max ~600 KB)');
      }
    }

    // 3. Filter out undefined values (fields not sent by client).
    //    Keep explicit null — that's how you clear a printer default.
    const entries = Object.entries(dto).filter(([_, val]) => val !== undefined);
    if (entries.length === 0) {
      throw new BadRequestException('No fields to update');
    }

    // 4. Validate printer defaults before opening the transaction
    for (const [key, val] of entries) {
      if (key.startsWith('printer.default.') && val !== null) {
        const expectedStation = STATION_FOR_KEY[key];
        const r = await this.db.query(
          `SELECT p.id,
                  COALESCE(array_agg(ps.station::text)
                           FILTER (WHERE ps.station IS NOT NULL), '{}') AS stations
             FROM printers p
             LEFT JOIN printer_stations ps ON ps.printer_id = p.id
            WHERE p.id = $1 AND p.is_active = true
            GROUP BY p.id`,
          [val],
        );
        if (!r.rows[0]) {
          throw new BadRequestException(`Printer not found or inactive for ${key}`);
        }
        const stations: string[] = r.rows[0].stations ?? [];
        if (!stations.includes(expectedStation)) {
          throw new BadRequestException(
            `Printer station mismatch for ${key}: expected ${expectedStation}, got ${stations.join(', ') || 'none'}`,
          );
        }
      }
    }

    // 5. Write all keys atomically
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
    if (entries.some(([key]) => key === 'network_access')) this.network.invalidate();

    return { ok: true };
  }
}
