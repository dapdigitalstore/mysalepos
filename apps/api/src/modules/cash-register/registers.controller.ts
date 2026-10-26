import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { CloseRegisterDto, OpenRegisterDto, RegisterListQueryDto } from './cash-register.dto';
import { RegistersService } from './registers.service';

/**
 * Permissions follow Laravel: opening a register and asking whether one is open needs no permission (the POS does it),
 * details need `view_cash_register`, closing `close_cash_register`, the report `register_report.view`.
 * Static paths (`current`) are declared before `:id`.
 */
@ApiTags('cash-registers')
@ApiBearerAuth()
@Controller('cash-registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  /** `{ open, register }` for the signed-in user. */
  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.registers.current(user);
  }

  @Get('current/details')
  @RequirePermissions('view_cash_register')
  currentDetails(@CurrentUser() user: AuthUser) {
    return this.registers.details(user);
  }

  @Post('current/close')
  @HttpCode(200)
  @RequirePermissions('close_cash_register')
  closeCurrent(@CurrentUser() user: AuthUser, @Body() dto: CloseRegisterDto) {
    return this.registers.close(user, undefined, dto);
  }

  /** The register report. */
  @Get()
  @RequirePermissions('register_report.view')
  list(@CurrentUser() user: AuthUser, @Query() q: RegisterListQueryDto) {
    return this.registers.list(user, q);
  }

  @Post()
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenRegisterDto) {
    return this.registers.open(user, dto);
  }

  @Get(':id/details')
  @RequirePermissions('view_cash_register')
  details(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.registers.details(user, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('close_cash_register')
  close(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CloseRegisterDto) {
    return this.registers.close(user, id, dto);
  }
}
