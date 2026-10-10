import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import ms, { type StringValue } from 'ms';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthTokens, JwtPayload } from '../../common/types/auth.types.js';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

interface SessionMetadata {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private static readonly ARGON2_OPTIONS: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  private static readonly DUMMY_PASSWORD_HASH = argon2.hash(
    randomBytes(32).toString('hex'),
    AuthService.ARGON2_OPTIONS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<User> {
    const passwordHash = await argon2.hash(
      dto.password,
      AuthService.ARGON2_OPTIONS,
    );

    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });

    this.logger.log(`New user registered: ${user.id}`);
    return user;
  }

  async login(
    dto: LoginDto,
    metadata: SessionMetadata,
  ): Promise<{ user: User; tokens: AuthTokens }> {
    const user = await this.users.findByEmail(dto.email);

    if (!user) {
      const dummyHash = await AuthService.DUMMY_PASSWORD_HASH;
      await argon2.verify(dummyHash, dto.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user, metadata);
    return { user, tokens };
  }

  async refresh(
    refreshToken: string,
    metadata: SessionMetadata,
  ): Promise<{ user: User; tokens: AuthTokens }> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoked all sessions`,
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const now = new Date();
    if (stored.expiresAt <= now) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const tokens = await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshToken.updateMany({
        where: {
          id: stored.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      if (revoked.count !== 1) {
        return null;
      }

      return this.issueTokens(stored.user, metadata, transaction);
    });

    if (!tokens) {
      const current = await this.prisma.refreshToken.findUnique({
        where: { id: stored.id },
        select: { revokedAt: true, expiresAt: true },
      });

      if (current?.revokedAt) {
        await this.revokeAllForUser(stored.userId);
        this.logger.warn(
          `Refresh token reuse detected for user ${stored.userId}; revoked all sessions`,
        );
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      if (current && current.expiresAt <= new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    return { user: stored.user, tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllForUser(userId);
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    user: User,
    metadata: SessionMetadata,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessExpiresIn = this.config.getOrThrow<string>(
      'jwt.accessExpiresIn',
    );
    const refreshExpiresIn = this.config.getOrThrow<string>(
      'jwt.refreshExpiresIn',
    );
    const accessTtl = ms(accessExpiresIn as StringValue);
    const refreshTtl = ms(refreshExpiresIn as StringValue);

    if (!accessTtl || !refreshTtl) {
      throw new Error('JWT expiration configuration is invalid');
    }

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      algorithm: 'HS256',
      expiresIn: accessExpiresIn as StringValue,
    });

    const refreshToken = randomBytes(64).toString('hex');
    await client.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl),
        userAgent: metadata.userAgent?.slice(0, 512) ?? null,
        ipAddress: metadata.ipAddress?.slice(0, 45) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(accessTtl / 1000),
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
