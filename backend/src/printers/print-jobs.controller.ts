import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../orders/orders.service';

@Controller('print-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrintJobsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  async list(
    @Req() req: { user: AuthUser },
    @Query('status') status?: string,
    @Query('station') station?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 500);

    // Role-scoped visibility, enforced at the DB.
    const isPrivileged = req.user.role === 'MANAGER' || req.user.role === 'ADMIN';
    const sql = `
      SELECT pj.id, pj.ticket_type, pj.status, pj.attempts,
             pj.created_at, pj.sent_at, pj.printed_at,
             pj.last_error, pj.payload, pj.idempotency_key,
             o.order_number, o.waiter_id,
             u.full_name AS waiter_full_name,
             t.name AS table_name,
             pr.name AS printer_name, pr.station AS printer_station
        FROM print_jobs pj
        JOIN orders o    ON o.id = pj.order_id
        JOIN users u     ON u.id = o.waiter_id
        LEFT JOIN tables t ON t.id = o.table_id
        JOIN printers pr ON pr.id = pj.printer_id
       WHERE ($1::text IS NULL OR pj.status::text = $1)
         AND ($2::text IS NULL OR pj.ticket_type::text = $2)
         AND ($3::boolean = TRUE OR o.waiter_id = $4::uuid)
       ORDER BY pj.created_at DESC
       LIMIT $5`;
    const params = [status ?? null, station ?? null, isPrivileged, req.user.userId, limit];
    const r = await this.db.query(sql, params);
    return { count: r.rows.length, printJobs: r.rows };
  }
}
