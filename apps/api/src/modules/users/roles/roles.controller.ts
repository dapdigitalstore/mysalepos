import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { RoleDto } from './role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles.view')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.roles.list(user, q);
  }

  /** Any signed-in user may load the dropdown: the user form needs it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.roles.options(user);
  }

  @Get(':id')
  @RequirePermissions('roles.view', 'roles.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.roles.get(user, id);
  }

  @Post()
  @RequirePermissions('roles.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: RoleDto) {
    return this.roles.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('roles.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RoleDto) {
    return this.roles.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('roles.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.roles.remove(user, id);
  }
}

/** The permission groups a role editor shows, already filtered to the modules/settings of the caller's business. */
@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionCatalogController {
  constructor(private readonly roles: RolesService) {}

  @Get('catalog')
  @RequirePermissions('roles.view', 'roles.create', 'roles.update')
  catalog(@CurrentUser() user: AuthUser) {
    return this.roles.catalog(user);
  }
}
