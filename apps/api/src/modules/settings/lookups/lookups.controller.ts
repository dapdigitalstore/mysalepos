import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';

/** Read-only dropdown data used by the settings screens. Full management of schemes/layouts arrives with the invoice phase. */
@ApiTags('lookups')
@ApiBearerAuth()
@Controller()
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('currencies/options')
  async currencies() {
    const rows = await this.prisma.currencies.findMany({ orderBy: [{ country: 'asc' }] });
    return rows.map((c) => ({ id: c.id, label: `${c.country} - ${c.currency} (${c.code})`, code: c.code, symbol: c.symbol }));
  }

  @Get('invoice-schemes/options')
  async invoiceSchemes(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).invoice_schemes.findMany({ orderBy: { name: 'asc' } });
    return rows.map((s) => ({ id: s.id, label: s.name, isDefault: s.is_default }));
  }

  @Get('invoice-layouts/options')
  async invoiceLayouts(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.forTenant(user.businessId).invoice_layouts.findMany({ orderBy: { name: 'asc' } });
    return rows.map((l) => ({ id: l.id, label: l.name, isDefault: l.is_default }));
  }

  @Get('time-zones/options')
  timeZones() {
    // The runtime lists canonical names only; add the common alias used by existing data.
    const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'Asia/Kolkata', 'Asia/Colombo', 'UTC']);
    return [...zones].sort().map((z) => ({ id: z, label: z }));
  }
}
