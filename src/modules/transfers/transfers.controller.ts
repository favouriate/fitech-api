import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Transfer } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransfersService } from './transfers.service.js';
import type { PaginatedResult } from './transfers.service.js';

@ApiTags('Transfers')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @HttpCode(202)
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Transfer funds between NGN wallets (amount in NGN)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Unique key for this transfer; reuse only for identical retries',
  })
  @ApiResponse({
    status: 202,
    description:
      'Transfer completed or previous result replayed; stored amount is in NGN',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<Transfer> {
    if (!idempotencyKey?.trim())
      throw new BadRequestException('Idempotency-Key header is required');
    return this.transfersService.executeTransfer(user.id, dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({ summary: 'List transfers involving the current user' })
  @ApiQuery({ name: 'cursor', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
    @Query('cursor', new ParseUUIDPipe({ optional: true })) cursor?: string,
  ): Promise<PaginatedResult<Transfer>> {
    return this.transfersService.findAllForUser(user.id, limit, cursor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transfer involving the current user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Transfer> {
    return this.transfersService.findOneForUser(id, user.id);
  }
}
