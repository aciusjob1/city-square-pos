import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { DayService } from './day.service';
import { DayActionDto } from './dto/day-action.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../orders/orders.service';

@Controller('day')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CASHIER', 'MANAGER', 'ADMIN')
export class DayController {
  constructor(private readonly day: DayService) {}

  @Get('status')
  status() {
    return this.day.status();
  }

  @Post('close')
  close(@Body() dto: DayActionDto, @Req() req: { user: AuthUser }) {
    return this.day.close(req.user, dto?.force === true);
  }

  @Post('open')
  open(@Req() req: { user: AuthUser }) {
    return this.day.open(req.user);
  }

  @Post('rollover')
  rollover(@Body() dto: DayActionDto, @Req() req: { user: AuthUser }) {
    return this.day.rollover(req.user, dto?.force === true);
  }
}
