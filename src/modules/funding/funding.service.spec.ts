import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { FundingStatus, Prisma, WalletStatus } from '@prisma/client';
import type { Funding, Wallet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { FundingService } from './funding.service.js';
import { FundingController } from './funding.controller.js';
import { SimulatedProviderService } from './providers/simulated-provider.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const wallet: Wallet = {
  id: 'wallet',
  userId: 'user',
  currency: 'NGN',
  status: WalletStatus.ACTIVE,
  createdAt: now,
  updatedAt: now,
};
const pending: Funding = {
  id: 'funding',
  reference: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  walletId: wallet.id,
  amount: new Prisma.Decimal('500.1234'),
  currency: 'NGN',
  status: FundingStatus.PENDING,
  provider: 'SIMULATED',
  providerRef: 'SIM-test',
  failureReason: null,
  metadata: null,
  createdAt: now,
  completedAt: null,
  updatedAt: now,
};
const completed: Funding = {
  ...pending,
  status: FundingStatus.COMPLETED,
  completedAt: now,
};

describe('FundingService', () => {
  let service: FundingService;
  const events: string[] = [];
  const tx = { $queryRaw: mockFn(), funding: { update: mockFn() } };
  const prisma = {
    funding: {
      create: mockFn(),
      update: mockFn(),
      findUnique: mockFn(),
      updateMany: mockFn(),
    },
    wallet: { findUnique: mockFn() },
    $transaction: mockFn(),
  };
  const ledger = { recordEntry: mockFn(), getBalance: mockFn() };
  const wallets = { findByUser: mockFn() };
  const provider = { initiate: mockFn() };
  const queue = { add: mockFn() };
  const logger = { log: mockFn(), error: mockFn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    events.length = 0;
    wallets.findByUser.mockResolvedValue({ ...wallet, balance: 0 });
    prisma.wallet.findUnique.mockResolvedValue(wallet);
    prisma.funding.create.mockResolvedValue(pending);
    prisma.funding.update.mockResolvedValue(pending);
    prisma.funding.findUnique.mockResolvedValue(pending);
    prisma.funding.updateMany.mockResolvedValue({ count: 2 });
    provider.initiate.mockResolvedValue({
      providerRef: 'SIM-test',
      status: 'PENDING',
    });
    tx.$queryRaw.mockResolvedValueOnce([pending]).mockResolvedValue([wallet]);
    tx.funding.update.mockResolvedValue(completed);
    ledger.recordEntry.mockResolvedValue(undefined);
    ledger.getBalance.mockResolvedValue(500.1234);
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<Funding>) => {
        const result = await callback(tx);
        events.push('commit');
        return result;
      },
    );
    queue.add.mockImplementation(async () => {
      events.push('queue');
    });
    const module = await Test.createTestingModule({
      providers: [
        FundingService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
        { provide: WalletsService, useValue: wallets },
        { provide: SimulatedProviderService, useValue: provider },
        { provide: Logger, useValue: logger },
        { provide: getQueueToken('notifications'), useValue: queue },
      ],
    }).compile();
    service = module.get(FundingService);
  });

  it('initiates an NGN Decimal funding and saves the provider reference', async () => {
    await service.initiate('user', 500.1234);
    const data = prisma.funding.create.mock.calls[0][0].data;
    expect(data.amount.toFixed(4)).toBe('500.1234');
    expect(data.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(provider.initiate).toHaveBeenCalledWith(
      data.reference,
      500.1234,
      'NGN',
    );
    expect(ledger.recordEntry).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 10_000_001, 1.00001])(
    'rejects invalid amount %s',
    async (amount) => {
      await expect(service.initiate('user', amount)).rejects.toThrow(
        'Amount must be between',
      );
      expect(prisma.funding.create).not.toHaveBeenCalled();
    },
  );

  it('requires an existing wallet', async () => {
    wallets.findByUser.mockResolvedValue(null);
    await expect(service.initiate('user', 500)).rejects.toThrow(
      'Create a wallet first',
    );
  });

  it('checks ownership before reading the balance', async () => {
    prisma.wallet.findUnique.mockResolvedValue({ ...wallet, userId: 'other' });
    await expect(
      service.findByReference(pending.reference, 'user'),
    ).rejects.toThrow('Funding not found');
    expect(ledger.getBalance).not.toHaveBeenCalled();
  });

  it('locks funding then wallet and credits the ledger before marking COMPLETED', async () => {
    expect(await service.confirmFunding(pending.reference)).toBe(completed);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('"fundings"');
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('"wallets"');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(ledger.recordEntry).toHaveBeenCalledWith(tx, {
      walletId: wallet.id,
      amount: pending.amount,
      direction: 'CREDIT',
      reference: `FUND-${pending.reference}`,
      description: 'Funding deposit',
    });
    expect(events).toEqual(['commit', 'queue']);
    expect(queue.add).toHaveBeenCalledWith('funding-completed', {
      reference: pending.reference,
      walletId: wallet.id,
      amount: 500.1234,
      completedAt: now,
    });
  });

  it.each([
    FundingStatus.COMPLETED,
    FundingStatus.FAILED,
    FundingStatus.EXPIRED,
  ])('cannot credit funding in state %s', async (status) => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ ...pending, status }]);
    await expect(service.confirmFunding(pending.reference)).rejects.toThrow(
      `Cannot confirm funding in status ${status}`,
    );
    expect(ledger.recordEntry).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not finish funding or enqueue when ledger write fails', async () => {
    ledger.recordEntry.mockRejectedValue(new Error('ledger failed'));
    await expect(service.confirmFunding(pending.reference)).rejects.toThrow(
      'ledger failed',
    );
    expect(tx.funding.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('keeps committed funding successful when the queue fails', async () => {
    queue.add.mockRejectedValue(new Error('Redis unavailable'));
    expect(await service.confirmFunding(pending.reference)).toBe(completed);
    expect(logger.error).toHaveBeenCalled();
  });

  it('retries serialization conflicts', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect(await service.confirmFunding(pending.reference)).toBe(completed);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(ledger.recordEntry).toHaveBeenCalledTimes(1);
  });

  it('cannot fail a completed funding', async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([completed]);
    await expect(
      service.failFunding(pending.reference, 'rejected'),
    ).rejects.toThrow('Cannot fail funding in status COMPLETED');
    expect(tx.funding.update).not.toHaveBeenCalled();
  });

  it('fails a pending funding without creating a ledger entry', async () => {
    await service.failFunding(pending.reference, 'rejected');
    expect(tx.funding.update).toHaveBeenCalledWith({
      where: { id: pending.id },
      data: { status: 'FAILED', failureReason: 'rejected' },
    });
    expect(ledger.recordEntry).not.toHaveBeenCalled();
  });

  it('expires only pending funding older than the cutoff', async () => {
    expect(await service.expireStaleFundings(15)).toBe(2);
    const args = prisma.funding.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('PENDING');
    expect(args.where.createdAt.lt.getTime()).toBeLessThan(Date.now());
    expect(args.data.status).toBe('EXPIRED');
    expect(ledger.recordEntry).not.toHaveBeenCalled();
  });

  it('rejects inactive wallets and provider initiation failures', async () => {
    wallets.findByUser.mockResolvedValueOnce({ ...wallet, status: 'FROZEN' });
    await expect(service.initiate('user', 500)).rejects.toThrow('active NGN');
    provider.initiate.mockResolvedValue({
      providerRef: 'SIM-failed',
      status: 'FAILED',
    });
    await service.initiate('user', 500);
    expect(tx.funding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'FAILED',
          failureReason: 'Provider rejected funding initiation',
        },
      }),
    );
  });
  it('returns balance for owned references and hides missing records and wallets', async () => {
    expect(
      (await service.findByReference(pending.reference, 'user')).walletBalance,
    ).toBe(500.1234);
    prisma.funding.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.findByReference(pending.reference, 'user'),
    ).rejects.toThrow('Funding not found');
    prisma.wallet.findUnique.mockResolvedValue(null);
    await expect(
      service.findByReference(pending.reference, 'user'),
    ).rejects.toThrow('Funding not found');
  });
  it('rejects missing funding rows for confirmation and failure', async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(service.confirmFunding(pending.reference)).rejects.toThrow(
      'Funding not found',
    );
    await expect(
      service.failFunding(pending.reference, 'reason'),
    ).rejects.toThrow('Funding not found');
  });
  it('rejects missing or closed wallet rows before crediting', async () => {
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([]);
    await expect(service.confirmFunding(pending.reference)).rejects.toThrow(
      'Wallet not found',
    );
    tx.$queryRaw
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([{ ...wallet, status: 'CLOSED' }]);
    await expect(service.confirmFunding(pending.reference)).rejects.toThrow(
      'active NGN',
    );
    expect(ledger.recordEntry).not.toHaveBeenCalled();
  });
  it.each([0, -1, Infinity])(
    'rejects invalid reconciliation age %s',
    async (age) => {
      await expect(service.expireStaleFundings(age)).rejects.toThrow(
        'positive and finite',
      );
    },
  );
});

describe('FundingController', () => {
  it('blocks simulation in production before ownership lookup or credit', async () => {
    const findByReference = mockFn();
    const confirmFunding = mockFn();
    const module = await Test.createTestingModule({
      controllers: [FundingController],
      providers: [
        {
          provide: FundingService,
          useValue: { findByReference, confirmFunding },
        },
        { provide: ConfigService, useValue: { get: () => 'production' } },
      ],
    }).compile();
    const controller = module.get(FundingController);
    await expect(
      controller.simulateConfirm(pending.reference, {
        id: 'user',
        email: 'test@example.com',
      }),
    ).rejects.toThrow();
    expect(findByReference).not.toHaveBeenCalled();
    expect(confirmFunding).not.toHaveBeenCalled();
  });
});

function mockFn(implementation?: (...args: never[]) => unknown): jest.Mock {
  const fn = createMock<{ fn: jest.Mock }>().fn;
  if (implementation) fn.mockImplementation(implementation);
  return fn;
}
