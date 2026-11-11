import {
  BadRequestException, Body, Controller, Get, Post, Req, UseGuards,
} from '@nestjs/common';
import { StockService, AuthUser } from './stock.service';
import { RestockDto } from './dto/restock.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('stock')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MANAGER', 'ADMIN')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('balances')
  balances() {
    return this.stock.balances();
  }

  @Get('low-stock')
  lowStock() {
    return this.stock.lowStock();
  }

  @Post('restock')
  restock(@Body() dto: RestockDto, @Req() req: { user: AuthUser }) {
    return this.stock.restock(dto.productId, dto.quantity, dto.notes ?? null, req.user);
  }
}
