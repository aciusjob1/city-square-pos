import {
  BadRequestException, Controller, Get, Query, Req, UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('daily')
  @Roles('MANAGER', 'ADMIN')
  async daily(@Query('date') date?: string) {
    const d = date || new Date().toISOString().slice(0, 10);
    try {
      return await this.reports.dailySales(d);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Get('summary')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  async summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('waiterId') waiterId?: string,
    @Query('productId') productId?: string,
    @Query('granularity') granularity?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const parseUuid = (value: string | undefined, label: string) => {
      if (value === undefined || value === '') return undefined;
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(value)) {
        throw new Error(`${label} must be a valid identifier`);
      }
      return value;
    };
    try {
      return await this.reports.salesSummary(
        from || today,
        to || today,
        search,
        parseUuid(waiterId, 'waiterId'),
        parseUuid(productId, 'productId'),
        granularity
          ? (granularity as 'day' | 'week' | 'month' | 'year')
          : undefined,
      );
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  /**
   * A waiter's own sales only. The scope always comes from the token, so a
   * waiter can never read another waiter's numbers.
   */
  @Get('my-sales')
  @Roles('WAITER')
  async mySales(
    @Req() req: { user: { userId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      return await this.reports.salesSummary(
        from || today,
        to || today,
        undefined,
        req.user.userId,
        undefined,
        granularity
          ? (granularity as 'day' | 'week' | 'month' | 'year')
          : undefined,
      );
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }
}
