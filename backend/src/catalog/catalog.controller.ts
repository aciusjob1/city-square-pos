import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('products')
  products(@Req() req: { user: { role: string } }) {
    return this.catalog.products(req.user);
  }

  @Post('categories')
  @Roles('MANAGER', 'ADMIN')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles('MANAGER', 'ADMIN')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles('MANAGER', 'ADMIN')
  deactivateCategory(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.deactivateCategory(id);
  }

  @Post('products')
  @Roles('MANAGER', 'ADMIN')
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  // Front-of-house can only flip availability; price/category edits stay manager-only.
  @Patch('products/:id/availability')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  updateAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.catalog.updateProduct(id, { isAvailable: dto.isAvailable });
  }

  @Patch('products/:id')
  @Roles('MANAGER', 'ADMIN')
  updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete('products/:id')
  @Roles('MANAGER', 'ADMIN')
  deactivateProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.deactivateProduct(id);
  }
}
