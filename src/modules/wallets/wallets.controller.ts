import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';
import { LedgerEntryResponseDto } from '../ledger/dto/ledger-entry-response.dto.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { ListLedgerQueryDto } from './dto/list-ledger-query.dto.js';
import { WalletResponseDto } from './dto/wallet-response.dto.js';
import { WalletsService } from './wallets.service.js';
import type { PaginatedLedgerResult } from './wallets.service.js';

@ApiTags('Wallets')
@ApiBearerAuth('access-token')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create the user NGN wallet' })
  @ApiResponse({ status: 201, type: WalletResponseDto })
  @ApiResponse({ status: 409, description: 'Wallet already exists' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ): Promise<WalletResponseDto> {
    const wallet = await this.wallets.create(user.id, dto.currency);
    return { ...wallet, balance: 0 };
  }

  @Get('me')
  @ApiOperation({ summary: "Get the current user's wallet with balance" })
  @ApiResponse({ status: 200, type: WalletResponseDto })
  @ApiResponse({ status: 404, description: 'No wallet found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async mine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletResponseDto | null> {
    return this.wallets.findByUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WalletResponseDto })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletResponseDto> {
    return this.wallets.findOneForUser(id, user.id);
  }

  @Get(':id/ledger')
  @ApiOperation({ summary: 'Get paginated ledger entries for a wallet' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated ledger entries' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListLedgerQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    data: LedgerEntryResponseDto[];
    pagination: PaginatedLedgerResult['pagination'];
  }> {
    await this.wallets.findOneForUser(id, user.id);
    const result = await this.wallets.getLedgerEntries(
      id,
      query.cursor,
      query.limit ?? 20,
    );
    return {
      data: result.data.map((entry) => ({
        ...entry,
        amount: entry.amount.toFixed(4),
        metadata:
          typeof entry.metadata === 'object' &&
          entry.metadata !== null &&
          !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, unknown>)
            : null,
      })),
      pagination: result.pagination,
    };
  }
}
