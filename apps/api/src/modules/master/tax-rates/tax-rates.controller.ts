import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { AuthUser } from '../../../common/types';
import { TaxGroupDto, TaxRateDto } from './tax.dto';
import { TaxRatesService } from './tax-rates.service';

@ApiTags('tax-rates')
@ApiBearerAuth()
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly taxes: TaxRatesService) {}

  @Get()
  @RequirePermissions('tax_rate.view', 'tax_rate.create')
  list(@CurrentUser() user: AuthUser) {
    return this.taxes.list(user);
  }

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.taxes.options(user);
  }

  @Post()
  @RequirePermissions('tax_rate.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: TaxRateDto) {
    return this.taxes.create(user, dto);
  }

  @Post('groups')
  @RequirePermissions('tax_rate.create')
  createGroup(@CurrentUser() user: AuthUser, @Body() dto: TaxGroupDto) {
    return this.taxes.createGroup(user, dto);
  }

  @Put('groups/:id')
  @RequirePermissions('tax_rate.update')
  updateGroup(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TaxGroupDto) {
    return this.taxes.updateGroup(user, id, dto);
  }

  @Delete('groups/:id')
  @HttpCode(200)
  @RequirePermissions('tax_rate.delete')
  removeGroup(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.taxes.removeGroup(user, id);
  }

  @Put(':id')
  @RequirePermissions('tax_rate.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: TaxRateDto) {
    return this.taxes.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('tax_rate.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.taxes.remove(user, id);
  }
}
