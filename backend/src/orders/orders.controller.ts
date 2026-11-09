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
  list(@Req() req: { user: AuthUser }, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200);
    return this.orders.listForUser(req.user, n);
  }

  @Post(':id/cancel')
  @Roles('MANAGER', 'ADMIN')
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

  @Get(':id')
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.fetchFullOrder(id);
  }
}
