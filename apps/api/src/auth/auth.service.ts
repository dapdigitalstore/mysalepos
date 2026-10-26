import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, JwtPayload } from '../common/types';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { DUMMY_HASH, verifyLaravelPassword } from './laravel-hash';
import { LoginLimiter } from './login-limiter';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface UserRow {
  id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  language: string;
  business_id: number | null;
}

@Injectable()
export class AuthService {
  private readonly limiter = new LoginLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionsService,
  ) {}

  async login(username: string, password: string, ip: string): Promise<TokenPair & { user: AuthUser }> {
    const key = `${ip}|${username.toLowerCase()}`;
    this.limiter.assertAllowed(key);

    const row = await this.prisma.users.findFirst({ where: { username, deleted_at: null } });
    const passwordOk = await verifyLaravelPassword(password, row?.password ?? DUMMY_HASH);
    if (!row || !passwordOk || !row.allow_login || row.status !== 'active' || row.business_id == null) {
      this.limiter.recordFailure(key);
      throw new UnauthorizedException('Invalid username or password');
    }
    this.limiter.reset(key);
    const user = await this.buildUser(row);
    return { ...(await this.issueTokens(user)), user };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.loadActiveUser(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return this.issueTokens(user);
  }

  /** Called by JwtStrategy on every request, so deactivated users and permission changes apply quickly. */
  async loadActiveUser(userId: number): Promise<AuthUser | null> {
    const row = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null } });
    if (!row || !row.allow_login || row.status !== 'active' || row.business_id == null) return null;
    return this.buildUser(row);
  }

  private async buildUser(row: UserRow): Promise<AuthUser> {
    const businessId = row.business_id as number;
    const [access, timeZone] = await Promise.all([this.permissions.forUser(row.id, businessId), this.prisma.businessTimeZone(businessId)]);
    const administrators = (this.config.get<string>('ADMINISTRATOR_USERNAMES') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return {
      id: row.id,
      businessId,
      username: row.username ?? '',
      firstName: row.first_name,
      lastName: row.last_name ?? '',
      language: row.language,
      isAdmin: access.isAdmin,
      isSuperadmin: administrators.includes((row.username ?? '').toLowerCase()),
      permissions: access.permissions,
      timeZone,
    };
  }

  private async issueTokens(user: AuthUser): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, bid: user.businessId, username: user.username };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_TTL') ?? '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
