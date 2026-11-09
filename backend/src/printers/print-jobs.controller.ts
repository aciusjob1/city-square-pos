import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('print-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrintJobsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('MANAGER', 'ADMIN', 'CASHIER')
  async list(@Query('status') status?: string) {
    const r = await this.db.query(
      `SELECT pj.id, pj.ticket_type, pj.status, pj.attempts,
              pj.created_at, pj.sent_at, pj.printed_at,
              pj.last_error,
              o.order_number,
              pr.name AS printer_name, pr.station AS printer_station
         FROM print_jobs pj
         JOIN orders o   ON o.id = pj.order_id
         JOIN printers pr ON pr.id = pj.printer_id
        WHERE ($1::text IS NULL OR pj.status::text = $1)
        ORDER BY pj.created_at DESC
        LIMIT 200`,
      [status ?? null],
    );
    return { count: r.rows.length, printJobs: r.rows };
  }
}
