import { Module } from '@nestjs/common';
import { SpatieAccess } from './access/spatie-access';
import { CommissionAgentsController } from './agents/commission-agents.controller';
import { CommissionAgentsService } from './agents/commission-agents.service';
import { PermissionCatalogController, RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/** Users, roles & permissions and sales commission agents (Laravel: ManageUserController, RoleController, SalesCommissionAgentController). */
@Module({
  controllers: [UsersController, RolesController, PermissionCatalogController, CommissionAgentsController],
  providers: [UsersService, RolesService, CommissionAgentsService, SpatieAccess],
  exports: [UsersService, RolesService, CommissionAgentsService],
})
export class UsersModule {}
