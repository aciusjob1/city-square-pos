import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdatePrinterDto } from './dto/update-printer.dto';
import { CreatePrinterDto } from './dto/create-printer.dto';
import { PrinterDiscoveryService } from './printer-discovery.service';
import { PrinterDispatchService } from './printer-dispatch.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const SETTING_KEYS = [
  'printer.default.kitchen',
  'printer.default.bar',
  'printer.default.receipt',
];

const STATION_FOR_SETTING: Record<string, string> = {
  'printer.default.kitchen': 'KITCHEN',
  'printer.default.bar': 'BAR',
  'printer.default.receipt': 'NONE',
};

const PRINTER_SELECT = `
  SELECT p.id, p.name, p.ip_address, p.port, p.is_active, p.type,
         COALESCE(array_agg(ps.station::text ORDER BY ps.station)
                  FILTER (WHERE ps.station IS NOT NULL), '{}') AS stations
    FROM printers p
    LEFT JOIN printer_stations ps ON ps.printer_id = p.id`;

function toDto(p: any) {
  return {
    id: p.id,
    name: p.name,
    ipAddress: p.ip_address,
    port: p.port,
    stations: p.stations ?? [],
    isActive: p.is_active,
    type: p.type,
  };
}

@Controller('printers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER', 'ADMIN')
export class PrintersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly discovery: PrinterDiscoveryService,
    private readonly dispatch: PrinterDispatchService,
  ) {}

  @Get()
  async list() {
    const r = await this.db.query(
      `${PRINTER_SELECT}
        GROUP BY p.id
        ORDER BY p.created_at ASC`,
    );
    return { printers: r.rows.map(toDto) };
  }

  /**
   * Lists printers installed on the computer that runs the backend.
   * Nothing is stored until the manager explicitly adds a discovered printer.
   */
  @Get('discover')
  discover() {
    return this.discovery.discover();
  }

  @Post()
  async create(@Body() dto: CreatePrinterDto) {
    if (dto.type === 'NETWORK' && !dto.ipAddress) {
      throw new BadRequestException({
        code: 'IP_REQUIRED',
        message: 'IP address is required for a network printer.',
      });
    }

    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Printer name is required');

    const dup = await this.db.query(
      `SELECT id FROM printers
        WHERE is_active = true AND lower(name) = lower($1) AND type = $2`,
      [name, dto.type],
    );
    if (dup.rows[0]) {
      throw new ConflictException({
        code: 'DUPLICATE_PRINTER',
        message: 'An active printer with that name already exists.',
      });
    }

    const stations = Array.from(new Set(dto.stations));
    const id = await this.db.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO printers (name, ip_address, port, type, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          name,
          dto.type === 'OS' ? null : dto.ipAddress!.trim(),
          dto.port ?? 9100,
          dto.type,
          dto.isActive ?? true,
        ],
      );
      const printerId = inserted.rows[0].id;
      for (const station of stations) {
        await client.query(
          `INSERT INTO printer_stations (printer_id, station)
           VALUES ($1, $2::"Station")`,
          [printerId, station],
        );
      }
      return printerId;
    });

    return toDto(await this.loadPrinter(id));
  }

  /**
   * Sends a self-check ticket straight to the device so a manager can confirm
   * cabling/IP/paper before live orders start flowing. This bypasses
   * print_jobs on purpose — it is not part of order history.
   */
  @Post(':id/test')
  async testPrint(@Param('id', new ParseUUIDPipe()) id: string) {
    const current = await this.loadPrinter(id);
    if (!current) throw new NotFoundException('Printer not found');
    if (!current.is_active) {
      throw new BadRequestException({
        code: 'PRINTER_INACTIVE',
        message: 'Activate the printer before testing it.',
      });
    }
    try {
      await this.dispatch.testPrint(current);
    } catch (error: any) {
      throw new BadRequestException({
        code: 'PRINT_FAILED',
        message: `Test print failed: ${error?.message ?? error}`,
      });
    }
    return { ok: true, printer: toDto(current) };
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    const current = await this.loadPrinter(id);
    if (!current) throw new NotFoundException('Printer not found');

    // If deactivating via PATCH — same protection as DELETE
    if (dto.isActive === false && current.is_active === true) {
      const refs = await this.db.query(
        `SELECT key FROM settings WHERE key = ANY($1::text[]) AND (value)::text = $2`,
        [SETTING_KEYS, `"${id}"`],
      );
      if (refs.rows.length > 0) {
        throw new ConflictException({
          code: 'PRINTER_IN_USE',
          message: `Printer is assigned as default (${refs.rows.map((r: any) => r.key).join(', ')}). Change the default first.`,
        });
      }
    }

    // A default assignment needs its station to stay on this printer.
    if (dto.stations !== undefined) {
      const refs = await this.db.query(
        `SELECT key FROM settings WHERE key = ANY($1::text[]) AND (value)::text = $2`,
        [SETTING_KEYS, `"${id}"`],
      );
      for (const ref of refs.rows) {
        const needed = STATION_FOR_SETTING[ref.key];
        if (needed && !dto.stations.includes(needed as any)) {
          throw new ConflictException({
            code: 'PRINTER_IN_USE',
            message: `Printer is assigned as default for ${ref.key}. Keep the ${needed} station or clear that default first.`,
          });
        }
      }
    }

    // If changing type — same protection: a printer that is assigned as a
    // default for any station cannot be switched between NETWORK and OS,
    // because the two types have different dispatch semantics. The default
    // must be cleared first.
    if (dto.type !== undefined && dto.type !== current.type) {
      const refs = await this.db.query(
        `SELECT key FROM settings WHERE key = ANY($1::text[]) AND (value)::text = $2`,
        [SETTING_KEYS, `"${id}"`],
      );
      if (refs.rows.length > 0) {
        throw new ConflictException({
          code: 'PRINTER_IN_USE',
          message: `Printer is assigned as default (${refs.rows.map((r: any) => r.key).join(', ')}). Clear the default before changing its type.`,
        });
      }
    }

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Printer name is required');
      sets.push(`name = $${i++}`);
      params.push(name);
    }
    if (dto.ipAddress !== undefined) { sets.push(`ip_address = $${i++}`); params.push(dto.ipAddress.trim()); }
    if (dto.port !== undefined) { sets.push(`port = $${i++}`); params.push(dto.port); }
    if (dto.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(dto.isActive); }
    if (dto.type !== undefined) { sets.push(`type = $${i++}`); params.push(dto.type); }
    if (sets.length === 0 && dto.stations === undefined) {
      throw new BadRequestException('No fields to update');
    }

    await this.db.transaction(async (client) => {
      if (sets.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE printers SET ${sets.join(', ')} WHERE id = $${i}`,
          params,
        );
      }
      if (dto.stations !== undefined) {
        const stations = Array.from(new Set(dto.stations));
        await client.query(`DELETE FROM printer_stations WHERE printer_id = $1`, [id]);
        for (const station of stations) {
          await client.query(
            `INSERT INTO printer_stations (printer_id, station)
             VALUES ($1, $2::"Station")`,
            [id, station],
          );
        }
      }
    });

    return toDto(await this.loadPrinter(id));
  }

  @Delete(':id')
  async deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    const refs = await this.db.query(
      `SELECT key FROM settings WHERE key = ANY($1::text[]) AND (value)::text = $2`,
      [SETTING_KEYS, `"${id}"`],
    );
    if (refs.rows.length > 0) {
      throw new ConflictException({
        code: 'PRINTER_IN_USE',
        message: `Printer is assigned as default (${refs.rows.map((r: any) => r.key).join(', ')}). Change the default first.`,
      });
    }

    const r = await this.db.query(
      `UPDATE printers SET is_active = false WHERE id = $1 AND is_active = true RETURNING id`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundException('Printer not found or already inactive');
    return { id, isActive: false };
  }

  private async loadPrinter(id: string) {
    const r = await this.db.query(
      `${PRINTER_SELECT}
        WHERE p.id = $1
        GROUP BY p.id`,
      [id],
    );
    return r.rows[0] ?? null;
  }
}
