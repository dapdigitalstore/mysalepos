import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { LookupQueryDto, ReturnableSalesQueryDto, ReturnPaymentDto, SaveSellReturnDto, SellReturnListQueryDto } from './sell-return.dto';
import { SellReturnsService } from './sell-returns.service';

/**
 * Permissions follow Laravel `SellReturnController`: `access_sell_return` (all returns) or `access_own_sell_return`
 * (only the returns the user created). Refund payments use the sale payment permissions of `TransactionPaymentController`.
 * Static routes come before `:id` so they are not parsed as ids.
 */
@ApiTags('sell-returns')
@ApiBearerAuth()
@Controller('sell-returns')
export class SellReturnsController {
  constructor(private readonly returns: SellReturnsService) {}

  @Get()
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  list(@CurrentUser() user: AuthUser, @Query() q: SellReturnListQueryDto) {
    return this.returns.list(user, q);
  }

  /** Final sales to start a return from (with the return they already have). */
  @Get('sales')
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  sales(@CurrentUser() user: AuthUser, @Query() q: ReturnableSalesQueryDto) {
    return this.returns.returnableSales(user, q);
  }

  /** `?invoiceNo=` or `?saleId=`: the sale with its lines, sold / returned / returnable quantities and the form defaults. */
  @Get('lookup')
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  lookup(@CurrentUser() user: AuthUser, @Query() q: LookupQueryDto) {
    return this.returns.lookup(user, q);
  }

  @Get(':id')
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.returns.get(user, id);
  }

  /** Creates the return of a sale, or replaces its existing return (one return per sale, like Laravel). */
  @Post()
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveSellReturnDto) {
    return this.returns.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SaveSellReturnDto) {
    return this.returns.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('access_sell_return', 'access_own_sell_return')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.returns.remove(user, id);
  }

  /** Refund paid to the customer. Laravel: TransactionPaymentController@store needs `sell.payments`. */
  @Post(':id/payments')
  @RequirePermissions('sell.payments')
  addPayment(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ReturnPaymentDto) {
    return this.returns.addPayment(user, id, dto);
  }

  /** Laravel: TransactionPaymentController@destroy needs `delete_sell_payment`. */
  @Delete(':id/payments/:paymentId')
  @HttpCode(200)
  @RequirePermissions('delete_sell_payment')
  removePayment(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.returns.removePayment(user, id, paymentId);
  }
}
