import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from './can';
import { PERMISSIONS_KEY } from './decorators';
import type { AuthUser } from './types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !required.some((p) => can(user, p))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
