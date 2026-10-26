import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { AuthUser } from '../../../common/types';
import { BusinessSettingsDto } from './business-settings.dto';
import { BusinessSettingsService } from './business-settings.service';

@ApiTags('business')
@ApiBearerAuth()
@Controller('business/settings')
export class BusinessSettingsController {
  constructor(private readonly settings: BusinessSettingsService) {}

  @Get()
  @RequirePermissions('business_settings.access')
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions('business_settings.access')
  update(@CurrentUser() user: AuthUser, @Body() dto: BusinessSettingsDto) {
    return this.settings.update(user, dto);
  }
}
