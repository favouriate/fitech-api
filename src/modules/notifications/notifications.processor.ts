import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { getWorkerConnectionOptions } from '../../config/worker-connection.config.js';
import type { TransferNotification } from '../transfers/transfers.service.js';

@Processor('notifications', {
  // Resolve after ConfigModule has loaded .env, rather than at import time.
  get connection() {
    return getWorkerConnectionOptions();
  },
})
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly logger: Logger) {
    super();
  }

  async process(job: Job<TransferNotification>): Promise<void> {
    switch (job.name) {
      case 'transfer-completed':
        await this.sendTransferEmail(job.data);
        break;
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
    }
  }

  private async sendTransferEmail(
    details: TransferNotification,
  ): Promise<void> {
    // Placeholder only; no email is sent until a delivery provider is configured.
    this.logger.log(
      `Transfer email placeholder: ${details.transferId} (${details.reference})`,
    );
  }
}
