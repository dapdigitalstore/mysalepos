import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { BrandDto } from './brand.dto';
import { BrandsService } from './brands.service';

@ApiTags('brands')
@ApiBearerAuth()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermissions('brand.view', 'brand.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.brands.list(user, q);
  }

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.brands.options(user);
  }

  @Get(':id')
  @RequirePermissions('brand.view', 'brand.create', 'brand.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.brands.get(user, id);
  }

  @Post()
  @RequirePermissions('brand.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: BrandDto) {
    return this.brands.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('brand.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BrandDto) {
    return this.brands.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('brand.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.brands.remove(user, id);
  }
}
