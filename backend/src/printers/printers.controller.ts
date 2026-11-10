import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get,
  NotFoundException, Param, ParseUUIDPipe, Patch, UseGuards,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdatePrinterDto } from './dto/update-printer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const SETTING_KEYS = [
  'printer.default.kitchen',
  'printer.default.bar',
  'printer.default.receipt',
];

@Controller('printers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER', 'ADMIN')
export class PrintersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list() {
    const r = await this.db.query(
      `SELECT id, name, ip_address, port, station, is_active
         FROM printers ORDER BY station, created_at`,
    );
    return {
      printers: r.rows.map((p: any) => ({
        id: p.id,
        name: p.name,
        ipAddress: p.ip_address,
        port: p.port,
        station: p.station,
        isActive: p.is_active,
      })),
    };
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    // Load current printer
    const current = await this.db.query(
      `SELECT id, station, is_active FROM printers WHERE id = $1`,
      [id],
    );
    if (!current.rows[0]) throw new NotFoundException('Printer not found');

    // If deactivating via PATCH — same protection as DELETE
    if (dto.isActive === false && current.rows[0].is_active === true) {
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

    // If changing station — check it doesn't conflict with existing default assignment
    if (dto.station !== undefined && dto.station !== current.rows[0].station) {
      const expectedKeyForNewStation = {
        KITCHEN: 'printer.default.kitchen',
        BAR: 'printer.default.bar',
        NONE: 'printer.default.receipt',
      }[dto.station];

      const refs = await this.db.query(
        `SELECT key FROM settings WHERE key = ANY($1::text[]) AND (value)::text = $2`,
        [SETTING_KEYS, `"${id}"`],
      );
      if (refs.rows.length > 0) {
        for (const ref of refs.rows) {
          if (ref.key !== expectedKeyForNewStation) {
            throw new ConflictException({
              code: 'PRINTER_IN_USE',
              message: `Printer is assigned as default for ${ref.key}. Clear that assignment before changing its station.`,
            });
          }
        }
      }
    }

    // Build update
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (dto.name !== undefined) { sets.push(`name = $${i++}`); params.push(dto.name.trim()); }
    if (dto.ipAddress !== undefined) { sets.push(`ip_address = $${i++}`); params.push(dto.ipAddress.trim()); }
    if (dto.port !== undefined) { sets.push(`port = $${i++}`); params.push(dto.port); }
    if (dto.station !== undefined) { sets.push(`station = $${i++}::"Station"`); params.push(dto.station); }
    if (dto.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(dto.isActive); }
    if (sets.length === 0) throw new BadRequestException('No fields to update');
    params.push(id);

    const r = await this.db.query(
      `UPDATE printers SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, name, ip_address, port, station, is_active`,
      params,
    );
    const p = r.rows[0];
    return {
      id: p.id, name: p.name, ipAddress: p.ip_address, port: p.port,
      station: p.station, isActive: p.is_active,
    };
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
}
