import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

@Injectable()
export class BusinessMetricsService {
  constructor(
    @InjectMetric('transfers_total')
    private readonly transfers: Counter<'status'>,
    @InjectMetric('funding_initiated_total')
    private readonly fundingInitiated: Counter,
    @InjectMetric('funding_completed_total')
    private readonly fundingCompleted: Counter,
  ) {}

  recordTransfer(status: 'success' | 'failed'): void {
    this.transfers.inc({ status });
  }
  recordFundingInitiated(): void {
    this.fundingInitiated.inc();
  }
  recordFundingCompleted(): void {
    this.fundingCompleted.inc();
  }
}
