import { Module } from '@nestjs/common';
import { SellReturnsController } from './sell-returns.controller';
import { SellReturnsService } from './sell-returns.service';

/**
 * Sell returns (Laravel SellReturnController + TransactionUtil::addSellReturn). Reads sale data straight from the tables, so it
 * does not depend on the Sales module. Laravel writes no cash register rows for a return or its refund payments, so the
 * CashRegister module is not used.
 */
@Module({
  controllers: [SellReturnsController],
  providers: [SellReturnsService],
})
export class SellReturnsModule {}
