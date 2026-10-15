import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { WebhookPayloadDto } from './dto/webhook-payload.dto.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly logger: Logger,
  ) {}

  @Post('payment-provider')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({ summary: 'Receive webhooks from payment providers' })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed or acknowledged',
  })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() payload: WebhookPayloadDto,
  ): Promise<{ status: 'ok' }> {
    this.logger.debug(
      `Incoming webhook: signature length=${signature?.length ?? 'N/A'} bodyKeys=${Object.keys(payload).join(',')}`,
    );
    this.logger.debug(
      `rawBody present: ${!!req.rawBody}, isBuffer: ${Buffer.isBuffer(req.rawBody)}`,
    );
    if (!this.webhooksService.verifySignature(req.rawBody, signature)) {
      this.logger.warn('Invalid webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    await this.webhooksService.processEvent(payload);
    return { status: 'ok' };
  }
}
