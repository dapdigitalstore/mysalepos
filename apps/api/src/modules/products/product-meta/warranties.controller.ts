import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { WarrantiesService } from './warranties.service';
import { WarrantyDto } from './warranty.dto';

/** The Laravel controller has no permission checks of its own (only the Products menu gate), so the product permissions are used. */
@ApiTags('warranties')
@ApiBearerAuth()
@Controller('warranties')
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get()
  @RequirePermissions('product.view', 'product.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.warranties.list(user, q);
  }

  /** Any signed-in user may load the dropdown: the product form needs it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.warranties.options(user);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.warranties.get(user, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: WarrantyDto) {
    return this.warranties.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('product.update', 'product.create')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: WarrantyDto) {
    return this.warranties.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('product.delete', 'product.create')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.warranties.remove(user, id);
  }
}
