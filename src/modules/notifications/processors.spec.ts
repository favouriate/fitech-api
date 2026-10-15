import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor.js';
import type { TransferNotification } from '../transfers/transfers.service.js';
import { ReconciliationProcessor } from '../funding/reconciliation.processor.js';
import { FundingService } from '../funding/funding.service.js';
import { SimulatedProviderService } from '../funding/providers/simulated-provider.service.js';

describe('Notification and reconciliation workers', () => {
  const logger = createMock<Logger>();
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('handles completed transfers and safely logs unsupported jobs', async () => {
    const worker = new NotificationsProcessor(logger);
    await worker.process(
      createMock<Job<TransferNotification>>({
        name: 'transfer-completed',
        data: {
          transferId: 'id',
          senderWalletId: 'sender',
          receiverWalletId: 'receiver',
          amount: '500',
          currency: 'NGN',
          reference: 'TRF-ref',
        },
      }),
    );
    await worker.process(
      createMock<Job<TransferNotification>>({ name: 'unknown' }),
    );
    expect(logger.log).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
  it('expires only funding reconciliation jobs using the 15-minute window', async () => {
    const funding = createMock<FundingService>();
    funding.expireStaleFundings.mockResolvedValue(2);
    const worker = new ReconciliationProcessor(funding, logger);
    await worker.process(
      createMock<Job<Record<string, never>>>({ name: 'unknown' }),
    );
    expect(funding.expireStaleFundings).not.toHaveBeenCalled();
    await worker.process(
      createMock<Job<Record<string, never>>>({ name: 'expire-stale-fundings' }),
    );
    expect(funding.expireStaleFundings).toHaveBeenCalledWith(15);
  });
  it('simulates provider acceptance without crediting any wallet', async () => {
    const result = await new SimulatedProviderService(logger).initiate(
      'reference',
      500,
      'NGN',
    );
    expect(result.status).toBe('PENDING');
    expect(result.providerRef).toMatch(/^SIM-/);
  });
});
