import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { InitiateFundingDto } from './dto/initiate-funding.dto.js';
import {
  FundingResponseDto,
  FundingStatusResponseDto,
} from './dto/funding-response.dto.js';
import { FundingService } from './funding.service.js';

@ApiTags('Funding')
@ApiBearerAuth('access-token')
@Controller('funding')
export class FundingController {
  constructor(
    private readonly fundingService: FundingService,
    private readonly config: ConfigService,
  ) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Initiate a wallet funding — returns a reference for status tracking',
  })
  @ApiResponse({
    status: 201,
    type: FundingResponseDto,
    description: 'Funding initiated (PENDING)',
  })
  @ApiResponse({ status: 400, description: 'Invalid amount' })
  @ApiResponse({ status: 404, description: 'No wallet found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiateFundingDto,
  ): Promise<FundingResponseDto> {
    const funding = await this.fundingService.initiate(user.id, dto.amount);
    return { ...funding, amount: funding.amount.toFixed(4) };
  }

  @Get(':reference')
  @ApiOperation({ summary: 'Get funding status by reference' })
  @ApiParam({
    name: 'reference',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiResponse({ status: 200, type: FundingStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Funding not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getStatus(
    @Param('reference', ParseUUIDPipe) reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingStatusResponseDto> {
    const { funding, walletBalance } =
      await this.fundingService.findByReference(reference, user.id);
    return {
      ...funding,
      amount: funding.amount.toFixed(4),
      walletBalance: walletBalance.toFixed(4),
    };
  }

  @Post(':reference/simulate-confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '[DEV-ONLY] Simulate provider confirmation',
    description:
      'Simulates a payment provider confirming the deposit. Disabled in production.',
  })
  @ApiParam({ name: 'reference', format: 'uuid' })
  @ApiResponse({
    status: 200,
    type: FundingResponseDto,
    description: 'Funding confirmed and wallet credited',
  })
  @ApiResponse({
    status: 404,
    description: 'Funding not found or endpoint disabled in production',
  })
  @ApiResponse({ status: 409, description: 'Funding is not PENDING' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async simulateConfirm(
    @Param('reference', ParseUUIDPipe) reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FundingResponseDto> {
    if (this.config.get<string>('app.nodeEnv') === 'production')
      throw new NotFoundException();
    await this.fundingService.findByReference(reference, user.id);
    const funding = await this.fundingService.confirmFunding(reference);
    return { ...funding, amount: funding.amount.toFixed(4) };
  }
}
