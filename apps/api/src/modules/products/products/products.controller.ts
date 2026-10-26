import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { AuthUser } from '../../../common/types';
import { OpeningStockService } from './opening-stock.service';
import { BulkActionDto, CheckSkuQueryDto, GroupPricesDto, OpeningStockDto, ProductDto, ProductListQueryDto, SearchQueryDto } from './product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly openingStock: OpeningStockService,
  ) {}

  // Fixed paths first: they must be registered before `:id`.

  @Get()
  @RequirePermissions('product.view', 'product.create')
  list(@CurrentUser() user: AuthUser, @Query() q: ProductListQueryDto) {
    return this.products.list(user, q);
  }

  /** Business settings and what the user may see; any signed-in user (the product form needs it). */
  @Get('form-meta')
  formMeta(@CurrentUser() user: AuthUser) {
    return this.products.formMeta(user);
  }

  /** Sub-units of a unit for the product form and combo picker. */
  @Get('sub-units')
  subUnits(@CurrentUser() user: AuthUser, @Query('unitId', ParseIntPipe) unitId: number) {
    return this.products.subUnits(user, unitId);
  }

  @Get('check-sku')
  @RequirePermissions('product.create', 'product.update')
  checkSku(@CurrentUser() user: AuthUser, @Query() q: CheckSkuQueryDto) {
    return this.products.checkSku(user, q);
  }

  /** Variation autocomplete for POS, purchases, transfers and combos. Open to any signed-in user like Laravel's /products/list. */
  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query() q: SearchQueryDto) {
    return this.products.search(user, q);
  }

  @Post('bulk-action')
  @HttpCode(200)
  @RequirePermissions('product.delete', 'product.update')
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkActionDto) {
    // Deleting needs product.delete, (de)activating needs product.update.
    return this.products.bulk(user, dto);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.get(user, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: ProductDto) {
    return this.products.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('product.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ProductDto) {
    return this.products.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('product.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.remove(user, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('product.update')
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.setActive(user, id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('product.update')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.setActive(user, id, false);
  }

  @Post(':id/duplicate')
  @RequirePermissions('product.create')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.duplicate(user, id);
  }

  @Get(':id/group-prices')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  groupPrices(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.products.getGroupPrices(user, id);
  }

  /** Laravel `save-selling-prices` is behind product.create; editing needs product.update. */
  @Put(':id/group-prices')
  @RequirePermissions('product.create', 'product.update')
  saveGroupPrices(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: GroupPricesDto) {
    return this.products.saveGroupPrices(user, id, dto);
  }

  @Get(':id/opening-stock')
  @RequirePermissions('product.opening_stock')
  getOpeningStock(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.openingStock.get(user, id);
  }

  @Put(':id/opening-stock')
  @RequirePermissions('product.opening_stock')
  saveOpeningStock(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: OpeningStockDto) {
    return this.openingStock.save(user, id, dto);
  }
}
