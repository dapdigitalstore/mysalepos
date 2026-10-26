import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { ChangePasswordDto, ProfileDto, UserDto } from './user.dto';
import { UsersService } from './users.service';

/**
 * Static paths (`options`, `form-meta`, `contacts-lookup`, `me`) are declared before `:id` so they are not read as ids.
 * The `me` endpoints need no permission: everyone may manage their own profile.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.view', 'user.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.users.list(user, q);
  }

  /** Any signed-in user may load the dropdown (sales, expenses and reports filter by user). */
  @Get('options')
  options(@CurrentUser() user: AuthUser, @Query('includeCommissionAgents') includeCommissionAgents?: string) {
    return this.users.options(user, includeCommissionAgents === 'true');
  }

  @Get('form-meta')
  @RequirePermissions('user.create', 'user.update')
  formMeta(@CurrentUser() user: AuthUser) {
    return this.users.formMeta(user);
  }

  @Get('contacts-lookup')
  @RequirePermissions('user.create', 'user.update')
  contactLookup(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.users.contactLookup(user, q);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user);
  }

  @Put('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
    return this.users.updateProfile(user, dto);
  }

  @Put('me/password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user, dto);
  }

  @Get(':id')
  @RequirePermissions('user.view', 'user.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.get(user, id);
  }

  @Post()
  @RequirePermissions('user.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: UserDto) {
    return this.users.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('user.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UserDto) {
    return this.users.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('user.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.remove(user, id);
  }
}
