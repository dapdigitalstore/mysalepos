import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { AuthUser } from '../../../common/types';
import { LocationDto } from './location.dto';
import { LocationsService } from './locations.service';

@ApiTags('business-locations')
@ApiBearerAuth()
@Controller('business-locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermissions('business_settings.access')
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.locations.list(user, search);
  }

  /** Any signed-in user may load this: forms need it. It only lists locations the user may use. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.locations.options(user);
  }

  @Get('check-id')
  @RequirePermissions('business_settings.access')
  checkId(@CurrentUser() user: AuthUser, @Query('locationId') locationId: string, @Query('exceptId') exceptId?: string) {
    const except = Number(exceptId);
    return this.locations.checkLocationId(user, locationId ?? '', Number.isInteger(except) && except > 0 ? except : undefined);
  }

  /** Header data for printing a receipt or invoice; any signed-in user with access to the location. */
  @Get(':id/print-info')
  printInfo(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.locations.printInfo(user, id);
  }

  @Get(':id')
  @RequirePermissions('business_settings.access')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.locations.get(user, id);
  }

  @Post()
  @RequirePermissions('business_settings.access')
  create(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.locations.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('business_settings.access')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: LocationDto) {
    return this.locations.update(user, id, dto);
  }

  @Post(':id/toggle-active')
  @RequirePermissions('business_settings.access')
  toggle(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.locations.toggleActive(user, id);
  }
}
