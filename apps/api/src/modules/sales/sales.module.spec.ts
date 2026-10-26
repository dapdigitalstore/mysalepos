import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SalePaymentsController, SalesController } from './sales.controller';
import { SalesModule } from './sales.module';
import { SalesService } from './sales.service';

@Global()
@Module({ providers: [{ provide: PrismaService, useValue: {} }], exports: [PrismaService] })
class FakePrismaModule {}

describe('SalesModule wiring', () => {
  it('resolves every provider and controller (what Nest does at start-up)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePrismaModule, SalesModule] }).compile();
    expect(moduleRef.get(SalesService)).toBeDefined();
    expect(moduleRef.get(SalesController)).toBeDefined();
    expect(moduleRef.get(SalePaymentsController)).toBeDefined();
    await moduleRef.close();
  });
});
