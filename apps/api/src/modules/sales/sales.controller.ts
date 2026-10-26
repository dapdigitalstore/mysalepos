import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { DraftListQueryDto, InvoiceNoQueryDto, PaymentDto, PosSettingsQueryDto, ProductRowQueryDto, RecentQueryDto, SaleDto, SaleListQueryDto } from './sale.dto';
import { SalePaymentsService } from './sale-payments.service';
import { SalesReadService } from './sales-read.service';
import { SalesService } from './sales.service';

/** Permissions follow Laravel's SellController / SellPosController / TransactionPaymentController (see docs/SALES-API.md). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly reader: SalesReadService,
    private readonly payments: SalePaymentsService,
  ) {}

  // Fixed paths first: they must be registered before `:id`.

  /** Business + POS settings, locations, payment methods, taxes, price groups and the user's selling permissions. */
  @Get('pos-settings')
  @RequirePermissions('sell.create', 'direct_sell.access', 'sell.update', 'sell.view')
  posSettings(@CurrentUser() user: AuthUser, @Query() q: PosSettingsQueryDto) {
    return this.reader.posSettings(user, q);
  }

  /** Defaults for adding a variation to a sale (price, tax, units, stock, lots, combo components). */
  @Get('product-row')
  @RequirePermissions('sell.create', 'direct_sell.access', 'sell.update')
  productRow(@CurrentUser() user: AuthUser, @Query() q: ProductRowQueryDto) {
    return this.reader.productRow(user, q);
  }

  /** The user's latest POS sales / drafts / quotations (POS "recent transactions"). */
  @Get('recent')
  @RequirePermissions('sell.create', 'direct_sell.access')
  recent(@CurrentUser() user: AuthUser, @Query() q: RecentQueryDto) {
    return this.reader.recent(user, q);
  }

  @Get('check-invoice-no')
  @RequirePermissions('sell.create', 'direct_sell.access', 'sell.update')
  checkInvoiceNo(@CurrentUser() user: AuthUser, @Query() q: InvoiceNoQueryDto) {
    return this.sales.invoiceNoAvailable(user, q.invoiceNo, q.excludeId);
  }

  @Get('drafts')
  @RequirePermissions('list_drafts')
  drafts(@CurrentUser() user: AuthUser, @Query() q: DraftListQueryDto) {
    return this.reader.listDrafts(user, q, false);
  }

  @Get('quotations')
  @RequirePermissions('list_quotations')
  quotations(@CurrentUser() user: AuthUser, @Query() q: DraftListQueryDto) {
    return this.reader.listDrafts(user, q, true);
  }

  @Get()
  @RequirePermissions('sell.view', 'sell.create', 'direct_sell.access', 'direct_sell.view', 'view_own_sell_only', 'view_commission_agent_sell', 'access_shipping', 'access_own_shipping')
  list(@CurrentUser() user: AuthUser, @Query() q: SaleListQueryDto) {
    return this.reader.list(user, q);
  }

  @Post()
  @RequirePermissions('sell.create', 'direct_sell.access')
  create(@CurrentUser() user: AuthUser, @Body() dto: SaleDto) {
    return this.sales.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('sell.view', 'sell.create', 'direct_sell.access', 'direct_sell.view', 'view_own_sell_only', 'list_drafts', 'list_quotations')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.reader.get(user, id);
  }

  @Put(':id')
  @RequirePermissions('sell.update', 'direct_sell.access')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SaleDto) {
    return this.sales.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('sell.delete', 'direct_sell.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.sales.remove(user, id);
  }

  @Post(':id/convert-to-invoice')
  @HttpCode(200)
  @RequirePermissions('sell.create', 'direct_sell.access')
  convertToInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.sales.convertToInvoice(user, id);
  }

  @Post(':id/convert-to-proforma')
  @HttpCode(200)
  @RequirePermissions('sell.create', 'direct_sell.access')
  convertToProforma(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.sales.convertToProforma(user, id);
  }

  @Post(':id/duplicate')
  @RequirePermissions('sell.create')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.sales.duplicate(user, id);
  }

  // ---- payments of a sale (TransactionPaymentController)

  @Get(':id/payments')
  @RequirePermissions('sell.payments')
  listPayments(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.listForSale(user, id);
  }

  @Get(':id/payment-defaults')
  @RequirePermissions('sell.payments')
  paymentDefaults(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.defaults(user, id);
  }

  @Post(':id/payments')
  @RequirePermissions('sell.payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PaymentDto) {
    return this.payments.add(user, id, dto);
  }
}

/** Single payments: view, edit and delete (Laravel: sell.payments / edit_sell_payment / delete_sell_payment). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sale-payments')
export class SalePaymentsController {
  constructor(private readonly payments: SalePaymentsService) {}

  @Get(':id')
  @RequirePermissions('sell.payments', 'edit_sell_payment', 'delete_sell_payment')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.get(user, id);
  }

  @Put(':id')
  @RequirePermissions('edit_sell_payment')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PaymentDto) {
    return this.payments.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('delete_sell_payment')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.remove(user, id);
  }
}
