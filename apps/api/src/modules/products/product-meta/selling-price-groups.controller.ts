import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { SellingPriceGroupDto } from './selling-price-group.dto';
import { SellingPriceGroupsService } from './selling-price-groups.service';

/** Same permissions as Laravel's SellingPriceGroupController: product.create for everything, product.update for edit. */
@ApiTags('selling-price-groups')
@ApiBearerAuth()
@Controller('selling-price-groups')
export class SellingPriceGroupsController {
  constructor(private readonly groups: SellingPriceGroupsService) {}

  @Get()
  @RequirePermissions('product.create', 'product.update')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.groups.list(user, q);
  }

  /** Any signed-in user may load the dropdown; it only contains active groups the user holds the permission for. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.groups.options(user);
  }

  @Get(':id')
  @RequirePermissions('product.create', 'product.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.groups.get(user, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: SellingPriceGroupDto) {
    return this.groups.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('product.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SellingPriceGroupDto) {
    return this.groups.update(user, id, dto);
  }

  @Post(':id/toggle-active')
  @HttpCode(200)
  @RequirePermissions('product.create')
  toggleActive(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.groups.toggleActive(user, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('product.create')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(user, id);
  }
}
