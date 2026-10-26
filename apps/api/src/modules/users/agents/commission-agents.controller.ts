import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import { PageQueryDto } from '../../../common/pagination';
import type { AuthUser } from '../../../common/types';
import { CommissionAgentDto } from './commission-agent.dto';
import { CommissionAgentsService } from './commission-agents.service';

/** Same permissions as Laravel's SalesCommissionAgentController: user.view/create/update/delete. */
@ApiTags('commission-agents')
@ApiBearerAuth()
@Controller('commission-agents')
export class CommissionAgentsController {
  constructor(private readonly agents: CommissionAgentsService) {}

  @Get()
  @RequirePermissions('user.view', 'user.create')
  list(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
    return this.agents.list(user, q);
  }

  /** Any signed-in user may load the dropdown: sales forms need it. */
  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.agents.options(user);
  }

  @Get(':id')
  @RequirePermissions('user.view', 'user.update')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.agents.get(user, id);
  }

  @Post()
  @RequirePermissions('user.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CommissionAgentDto) {
    return this.agents.create(user, dto);
  }

  @Put(':id')
  @RequirePermissions('user.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CommissionAgentDto) {
    return this.agents.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('user.delete')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.agents.remove(user, id);
  }
}
