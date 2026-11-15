import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { getWorkerConnectionOptions } from '../../config/worker-connection.config.js';
import { FundingService } from './funding.service.js';

@Processor('funding-reconciliation', {
  // Resolve after ConfigModule has loaded .env, rather than at import time.
  get connection() {
    return getWorkerConnectionOptions();
  },
})
export class ReconciliationProcessor extends WorkerHost {
  constructor(
    private readonly funding: FundingService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<Record<string, never>>): Promise<void> {
    if (job.name !== 'expire-stale-fundings') return;
    this.logger.log('Running funding reconciliation...');
    const expired = await this.funding.expireStaleFundings(15);
    this.logger.log(
      `Reconciliation complete. Expired ${expired} stale fundings.`,
    );
  }
}
