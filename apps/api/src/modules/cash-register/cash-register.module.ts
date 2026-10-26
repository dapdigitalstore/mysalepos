import { Module } from '@nestjs/common';
import { CashRegisterService } from './cash-register.service';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';

/**
 * Cash registers: open / current / details / close / report endpoints (RegistersController) and the payment hooks the
 * Sales module calls inside its own transaction (CashRegisterService, exported).
 */
@Module({
  controllers: [RegistersController],
  providers: [CashRegisterService, RegistersService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
