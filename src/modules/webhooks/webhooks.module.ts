import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FundingModule } from '../funding/funding.module.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

@Module({
  imports: [FundingModule, BullModule.registerQueue({ name: 'notifications' })],
  providers: [WebhooksService, WebhookSignatureGuard, Logger],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
