import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { VariationTemplateDto } from './variation-template.dto';
import { VariationTemplatesService } from './variation-templates.service';

/** The Laravel controller has no permission checks of its own (only the Products menu gate), so the product permissions are used. */
@ApiTags('variation-templates')
@ApiBearerAuth()
@Controller('variation-templates')
export class VariationTemplatesController {
  constructor(private readonly templates: VariationTemplatesService) {}

  @Get()
  @RequirePermissions('product.view', 'product.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.templates.list(user, q);
  }

  /** Any signed-in user may load the dropdown: the product form needs it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.templates.options(user);
  }

  @Get(':id')
  @RequirePermissions('product.view', 'product.create', 'product.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.templates.get(user, id);
  }

  @Post()
  @RequirePermissions('product.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: VariationTemplateDto) {
    return this.templates.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('product.update', 'product.create')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: VariationTemplateDto) {
    return this.templates.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('product.delete', 'product.create')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.templates.remove(user, id);
  }
}
