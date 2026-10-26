import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PageQueryDto } from '../../common/pagination';
import type { AuthUser } from '../../common/types';
import { CustomerGroupDto } from './customer-group.dto';
import { CustomerGroupsService } from './customer-groups.service';

@ApiTags('customer-groups')
@ApiBearerAuth()
@Controller('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly groups: CustomerGroupsService) {}

  @Get()
  @RequirePermissions('customer.view')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.groups.list(user, q);
  }

  /** Any signed-in user may load the dropdown: contact forms and filters need it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.groups.options(user);
  }

  /** Selling price groups for the group form. */
  @Get('price-groups')
  @RequirePermissions('customer.create', 'customer.update')
  priceGroups(@CurrentUser() user: AuthUser) {
    return this.groups.priceGroups(user);
  }

  @Get(':id')
  @RequirePermissions('customer.view', 'customer.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.groups.get(user, id);
  }

  @Post()
  @RequirePermissions('customer.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CustomerGroupDto) {
    return this.groups.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('customer.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CustomerGroupDto) {
    return this.groups.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('customer.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(user, id);
  }
}
