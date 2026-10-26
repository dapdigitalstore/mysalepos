import { Module } from '@nestjs/common';
import { OpeningStockService } from './products/opening-stock.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/** Products work stream: the product catalogue with variations, per-location stock and opening stock. */
@Module({
  controllers: [ProductsController],
  providers: [ProductsService, OpeningStockService],
  exports: [ProductsService],
})
export class ProductsModule {}
