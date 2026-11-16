import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { StockService, AuthUser } from './stock.service';
import { RestockDto } from './dto/restock.dto';
import {
  CreatePoolDto, RestockPoolDto, UpdatePoolDto, UpsertPoolRecipeDto,
} from './dto/pool.dto';
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

  // Stock picture for every product, used by the Sold Out page so the two
  // screens always agree on what can still be cooked.
  @Get('availability')
  availability() {
    return this.stock.availability();
  }

  @Get('low-stock')
  lowStock() {
    return this.stock.lowStock();
  }

  @Post('restock')
  restock(@Body() dto: RestockDto, @Req() req: { user: AuthUser }) {
    return this.stock.restock(dto.productId, dto.quantity, dto.notes ?? null, req.user);
  }

  // ---------------- ingredient pools ----------------

  @Get('pools')
  pools() {
    return this.stock.pools();
  }

  @Post('pools')
  createPool(@Body() dto: CreatePoolDto) {
    return this.stock.createPool(dto);
  }

  @Patch('pools/:id')
  updatePool(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePoolDto,
  ) {
    return this.stock.updatePool(id, dto);
  }

  @Post('pools/:id/restock')
  restockPool(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RestockPoolDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.stock.restockPool(id, dto.quantity, dto.notes ?? null, req.user);
  }

  @Get('pools/:id/recipes')
  poolRecipes(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.stock.poolRecipes(id);
  }

  @Post('pools/:id/recipes')
  upsertPoolRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertPoolRecipeDto,
  ) {
    return this.stock.upsertPoolRecipe(id, dto.productId, dto.quantityPerUnit);
  }

  @Delete('pools/:id/recipes/:productId')
  removePoolRecipe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.stock.removePoolRecipe(id, productId);
  }
}
