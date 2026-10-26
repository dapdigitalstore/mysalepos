import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { MODULES } from './manifest';
import { parseEnabledFeatures, visibleModules } from './visible-modules';

@ApiTags('modules')
@ApiBearerAuth()
@Controller('modules')
export class RegistryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const business = await this.prisma.business.findUnique({ where: { id: user.businessId }, select: { enabled_modules: true } });
    return visibleModules(user, parseEnabledFeatures(business?.enabled_modules));
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const business = await this.prisma.business.findUnique({ where: { id: user.businessId }, select: { enabled_modules: true } });
    const found = visibleModules(user, parseEnabledFeatures(business?.enabled_modules), MODULES).find((m) => m.id === id);
    if (!found) throw new NotFoundException('Module not found');
    return found;
  }
}
