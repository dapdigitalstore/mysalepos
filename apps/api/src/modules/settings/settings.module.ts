import { Module } from '@nestjs/common';
import { BusinessSettingsController } from './business/business-settings.controller';
import { BusinessSettingsService } from './business/business-settings.service';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { LookupsController } from './lookups/lookups.controller';

/** Business profile and settings, business locations, and the lookups their forms need. */
@Module({
  controllers: [BusinessSettingsController, LocationsController, LookupsController],
  providers: [BusinessSettingsService, LocationsService],
  exports: [LocationsService],
})
export class SettingsModule {}
