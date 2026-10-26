import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { UnitDto } from './unit.dto';
import { UnitsService } from './units.service';

@ApiTags('units')
@ApiBearerAuth()
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermissions('unit.view', 'unit.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.units.list(user, q);
  }

  /** Any signed-in user may load the dropdown: product forms need it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser, @Query('onlyBase') onlyBase?: string) {
    return this.units.options(user, onlyBase !== 'false');
  }

  @Get(':id')
  @RequirePermissions('unit.view', 'unit.create', 'unit.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.units.get(user, id);
  }

  @Post()
  @RequirePermissions('unit.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: UnitDto) {
    return this.units.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('unit.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UnitDto) {
    return this.units.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('unit.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.units.remove(user, id);
  }
}
