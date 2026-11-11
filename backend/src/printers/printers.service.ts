import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Station } from './station.enum';

const SETTING_KEY_FOR_STATION: Record<string, string | null> = {
  KITCHEN: 'printer.default.kitchen',
  BAR: 'printer.default.bar',
  NONE: 'printer.default.receipt',
};

export interface ResolvedPrinter {
  id: string;
  name: string;
  type: 'NETWORK' | 'OS';
}

@Injectable()
export class PrintersService {
  private readonly logger = new Logger(PrintersService.name);

  /**
   * Returns the printer row for a station.
   * Precedence: settings-based default -> first active printer for station.
   * Called inside the order-creating transaction.
   */
  async findPrinterForStation(
    client: PoolClient,
    station: Station,
  ): Promise<ResolvedPrinter | null> {
    const settingKey = SETTING_KEY_FOR_STATION[station];

    if (settingKey) {
      const setting = await client.query<{ value: any }>(
        `SELECT value FROM settings WHERE key = $1`,
        [settingKey],
      );
      const printerId = setting.rows[0]?.value;
      if (printerId) {
        const pref = await client.query<ResolvedPrinter>(
          `SELECT id, name, type FROM printers WHERE id = $1 AND is_active = true`,
          [printerId],
        );
        if (pref.rows[0]) return pref.rows[0];
      }
    }

    const r = await client.query<ResolvedPrinter>(
      `SELECT id, name, type FROM printers
        WHERE station = $1 AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1`,
      [station],
    );
    return r.rows[0] ?? null;
  }
}
