import { Module } from '@nestjs/common';
import { BrandsController } from './brands/brands.controller';
import { BrandsService } from './brands/brands.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { TaxRatesController } from './tax-rates/tax-rates.controller';
import { TaxRatesService } from './tax-rates/tax-rates.service';
import { UnitsController } from './units/units.controller';
import { UnitsService } from './units/units.service';

/** Reference data used by products and sales: units, brands, categories, tax rates. */
@Module({
  controllers: [UnitsController, BrandsController, CategoriesController, TaxRatesController],
  providers: [UnitsService, BrandsService, CategoriesService, TaxRatesService],
  exports: [TaxRatesService],
})
export class MasterModule {}
