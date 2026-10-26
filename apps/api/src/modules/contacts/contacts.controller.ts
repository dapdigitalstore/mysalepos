import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { CheckContactIdQueryDto, CheckMobileQueryDto, ContactDto, ContactListQueryDto, ContactOptionsQueryDto } from './contact.dto';
import { ContactsService } from './contacts.service';

/**
 * Permissions follow Laravel: supplier.* / customer.* plus the *.view_own variants. The route guard only checks that
 * the user holds one of them; the service then narrows by contact type (and by ownership for view_own users).
 */
@ApiTags('contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  /** `?type=supplier|customer`. The service checks the matching view / view_own permission. */
  @Get()
  @RequirePermissions('supplier.view', 'supplier.view_own', 'customer.view', 'customer.view_own')
  list(@CurrentUser() user: AuthUser, @Query() q: ContactListQueryDto) {
    return this.contacts.list(user, q);
  }

  /** Any signed-in user may load the dropdown: sales and purchase forms need it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser, @Query() q: ContactOptionsQueryDto) {
    return this.contacts.options(user, q);
  }

  /** Warning only: the same mobile number may repeat. */
  @Get('check-mobile')
  @RequirePermissions('supplier.create', 'customer.create', 'supplier.update', 'customer.update', 'supplier.view_own', 'customer.view_own')
  checkMobile(@CurrentUser() user: AuthUser, @Query() q: CheckMobileQueryDto) {
    return this.contacts.checkMobile(user, q);
  }

  @Get('check-contact-id')
  @RequirePermissions('supplier.create', 'customer.create', 'supplier.update', 'customer.update', 'supplier.view_own', 'customer.view_own')
  checkContactId(@CurrentUser() user: AuthUser, @Query() q: CheckContactIdQueryDto) {
    return this.contacts.checkContactId(user, q);
  }

  @Get(':id')
  @RequirePermissions('supplier.view', 'supplier.view_own', 'customer.view', 'customer.view_own')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.get(user, id);
  }

  @Post()
  @RequirePermissions('supplier.create', 'customer.create', 'supplier.view_own', 'customer.view_own')
  create(@CurrentUser() user: AuthUser, @Body() dto: ContactDto) {
    return this.contacts.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('supplier.update', 'customer.update', 'supplier.view_own', 'customer.view_own')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ContactDto) {
    return this.contacts.update(user, id, dto);
  }

  /** Flips active <-> inactive (Laravel: updateStatus). */
  @Post(':id/toggle-status')
  @HttpCode(200)
  @RequirePermissions('supplier.update', 'customer.update', 'supplier.view_own', 'customer.view_own')
  toggleStatus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.toggleStatus(user, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('supplier.delete', 'customer.delete', 'supplier.view_own', 'customer.view_own')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.contacts.remove(user, id);
  }
}
