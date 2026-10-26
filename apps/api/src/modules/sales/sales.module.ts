import { Module } from '@nestjs/common';
import { CashRegisterModule } from '../cash-register/cash-register.module';
import { SaleNumberingService } from './sale-numbering.service';
import { SalePaymentsService } from './sale-payments.service';
import { SaleStockService } from './sale-stock.service';
import { SalePaymentsController, SalesController } from './sales.controller';
import { SalesReadService } from './sales-read.service';
import { SalesService } from './sales.service';

/** Owned by the Sales engine work stream: sales, POS, drafts, quotations, sale payments. */
@Module({
  imports: [CashRegisterModule],
  controllers: [SalesController, SalePaymentsController],
  providers: [SalesService, SalesReadService, SalePaymentsService, SaleStockService, SaleNumberingService],
  exports: [SalesService, SalesReadService, SalePaymentsService, SaleStockService, SaleNumberingService],
})
export class SalesModule {}
