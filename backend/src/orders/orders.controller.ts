import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { OrdersService, AuthUser } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { AppendItemsDto } from './dto/append-items.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { parseDateRange } from '../common/utils/date-range';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  create(@Body() dto: CreateOrderDto, @Req() req: { user: AuthUser }) {
    return this.orders.create(dto, req.user);
  }

  @Get()
  list(
    @Req() req: { user: AuthUser },
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const n = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 500);
    const range = parseDateRange(from, to);
    return this.orders.listForUser(req.user, n, range.from, range.to);
  }

  @Post(':id/cancel')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelOrderDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.orders.cancel(id, dto.reason, req.user);
  }

  @Post(':id/items')
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  appendItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AppendItemsDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.orders.appendItems(id, dto, req.user);
  }

  @Get('kitchen')
  @Roles('KITCHEN', 'MANAGER', 'ADMIN')
  kitchenList(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit || '100', 10) || 100, 1), 200);
    return this.orders.listForKitchen(n);
  }

  @Get(':id')
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.orders.fetchFullOrderForUser(id, req.user);
  }
}
