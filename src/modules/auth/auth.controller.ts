import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLE_TTL,
} from '../../config/throttler.config.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import {
  AuthResponseDto,
  MessageResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
@Throttle({
  auth: { ttl: AUTH_THROTTLE_TTL, limit: AUTH_THROTTLE_LIMIT },
})
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Create a user account' })
  @ApiCreatedResponse({ type: UserResponseDto })
  async register(@Body() dto: RegisterDto) {
    const user = await this.auth.register(dto);
    return this.users.toPublic(user);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and issue access and refresh tokens' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.auth.login(dto, this.getSessionMetadata(request));
    return {
      user: this.users.toPublic(result.user),
      tokens: result.tokens,
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    const result = await this.auth.refresh(
      dto.refreshToken,
      this.getSessionMetadata(request),
    );
    return {
      user: this.users.toPublic(result.user),
      tokens: result.tokens,
    };
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logoutAll(@CurrentUser('id') userId: string) {
    await this.auth.logoutAll(userId);
    return { message: 'Logged out from all devices successfully' };
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    const user = await this.users.findById(authenticatedUser.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.users.toPublic(user);
  }

  private getSessionMetadata(request: Request) {
    const userAgent = request.headers['user-agent'];
    return {
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      ipAddress: request.ip,
    };
  }
}
