import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../orders/orders.service';
import { parseDateRange } from '../common/utils/date-range';

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
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '100', 10) || 100, 1), 500);
    const { from, to } = parseDateRange(fromRaw, toRaw);

    // Role-scoped visibility, enforced at the DB. Cashiers and above see
    // every waiter's tickets; waiters only see their own.
    const isPrivileged = ['CASHIER', 'MANAGER', 'ADMIN'].includes(req.user.role);
    const sql = `
      SELECT pj.id, pj.ticket_type, pj.status, pj.attempts,
             pj.created_at, pj.sent_at, pj.printed_at,
             pj.last_error, pj.payload, pj.idempotency_key,
             o.order_number, o.waiter_id,
             u.full_name AS waiter_full_name,
             t.name AS table_name,
             pr.name AS printer_name,
             COALESCE((
               SELECT array_agg(ps.station::text ORDER BY ps.station)
                 FROM printer_stations ps
                WHERE ps.printer_id = pr.id
             ), '{}') AS printer_stations
        FROM print_jobs pj
        JOIN orders o    ON o.id = pj.order_id
        JOIN users u     ON u.id = o.waiter_id
        LEFT JOIN tables t ON t.id = o.table_id
        LEFT JOIN printers pr ON pr.id = pj.printer_id
       WHERE ($1::text IS NULL OR pj.status::text = $1)
         AND ($2::text IS NULL OR pj.ticket_type::text = $2)
         AND ($3::boolean = TRUE OR o.waiter_id = $4::uuid)
         AND ($5::date IS NULL
              OR (pj.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date >= $5::date)
         AND ($6::date IS NULL
              OR (pj.created_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date <= $6::date)
       ORDER BY pj.created_at DESC
       LIMIT $7`;
    const params = [
      status ?? null,
      station ?? null,
      isPrivileged,
      req.user.userId,
      from,
      to,
      limit,
    ];
    const r = await this.db.query(sql, params);
    return { count: r.rows.length, printJobs: r.rows };
  }
}
