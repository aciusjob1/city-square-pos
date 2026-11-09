import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Station } from './station.enum';

@Injectable()
export class PrintersService {
  private readonly logger = new Logger(PrintersService.name);

  /**
   * Returns the active printer row for a station, or null if none is configured.
   * Called inside the order-creating transaction.
   */
  async findPrinterForStation(
    client: PoolClient,
    station: Station,
  ): Promise<{ id: string; name: string } | null> {
    const r = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM printers
        WHERE station = $1 AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1`,
      [station],
    );
    return r.rows[0] ?? null;
  }
}
