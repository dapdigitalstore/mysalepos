import { Module } from '@nestjs/common';
import { SellingPriceGroupsController } from './product-meta/selling-price-groups.controller';
import { SellingPriceGroupsService } from './product-meta/selling-price-groups.service';
import { VariationTemplatesController } from './product-meta/variation-templates.controller';
import { VariationTemplatesService } from './product-meta/variation-templates.service';
import { WarrantiesController } from './product-meta/warranties.controller';
import { WarrantiesService } from './product-meta/warranties.service';

/** Product metadata: variation templates, warranties, selling price groups. */
@Module({
  controllers: [VariationTemplatesController, WarrantiesController, SellingPriceGroupsController],
  providers: [VariationTemplatesService, WarrantiesService, SellingPriceGroupsService],
  exports: [VariationTemplatesService, WarrantiesService, SellingPriceGroupsService],
})
export class ProductMetaModule {}
