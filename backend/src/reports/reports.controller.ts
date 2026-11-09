import {
  BadRequestException, Controller, Get, Query, UseGuards,
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
}
