import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { CategoriesService } from './categories.service';
import { CategoryDto } from './category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('category.view', 'category.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.categories.list(user, q);
  }

  @Get('options')
  options(@CurrentUser() user: AuthUser, @Query('parentId') parentId?: string) {
    const id = Number(parentId);
    return this.categories.options(user, Number.isInteger(id) && id >= 0 ? id : 0);
  }

  @Get(':id')
  @RequirePermissions('category.view', 'category.create', 'category.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.categories.get(user, id);
  }

  @Post()
  @RequirePermissions('category.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CategoryDto) {
    return this.categories.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('category.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CategoryDto) {
    return this.categories.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('category.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.categories.remove(user, id);
  }
}
