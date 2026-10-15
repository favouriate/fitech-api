import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  Direction,
  IdempotencyStatus,
  Prisma,
  TransferStatus,
  WalletStatus,
} from '@prisma/client';
import type { Transfer, Wallet } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { TransfersService } from './transfers.service.js';

const date = new Date('2026-01-01T00:00:00.000Z');
const sender: Wallet = {
  id: 'z-sender',
  userId: 'user',
  currency: 'NGN',
  status: WalletStatus.ACTIVE,
  createdAt: date,
  updatedAt: date,
};
const receiver: Wallet = { ...sender, id: 'a-receiver', userId: 'other' };
const dto = { receiverWalletId: receiver.id, amount: 500 };
const requestHash = createHash('sha256')
  .update(JSON.stringify(dto))
  .digest('hex');
const completed: Transfer = {
  id: 'transfer',
  senderWalletId: sender.id,
  receiverWalletId: receiver.id,
  amount: new Prisma.Decimal(500),
  currency: 'NGN',
  status: TransferStatus.COMPLETED,
  reference: 'TRF-test',
  failureReason: null,
  createdAt: date,
  updatedAt: date,
};
const reservation = {
  id: 'reservation',
  key: 'key',
  userId: 'user',
  requestHash,
  status: IdempotencyStatus.STARTED,
  responseBody: null,
  createdAt: date,
  expiresAt: date,
};
const finished = {
  ...reservation,
  status: IdempotencyStatus.FINISHED,
  responseBody: {
    ...completed,
    amount: '500',
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
  },
};

describe('TransfersService', () => {
  let service: TransfersService;
  const events: string[] = [];
  const tx = {
    $queryRaw: mockFn(),
    ledgerEntry: { groupBy: mockFn() },
    transfer: { create: mockFn() },
    idempotencyKey: { update: mockFn() },
  };
  const prisma = {
    wallet: { findFirst: mockFn(), findMany: mockFn() },
    idempotencyKey: {
      findUnique: mockFn(),
      create: mockFn(),
      deleteMany: mockFn(),
    },
    transfer: { findFirst: mockFn(), findMany: mockFn() },
    $transaction: mockFn(),
  };
  const ledger = { recordEntry: mockFn() };
  const wallets = { findOneForUser: mockFn() };
  const queue = { add: mockFn() };
  const logger = { log: mockFn(), warn: mockFn(), error: mockFn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    events.length = 0;
    prisma.wallet.findFirst.mockResolvedValue(sender);
    prisma.wallet.findMany.mockResolvedValue([{ id: sender.id }]);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue(reservation);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 1 });
    tx.$queryRaw.mockImplementation(
      async (_strings: TemplateStringsArray, id: string) => [
        id === sender.id ? sender : receiver,
      ],
    );
    wallets.findOneForUser.mockResolvedValue({ ...sender, balance: 100000 });
    tx.ledgerEntry.groupBy.mockResolvedValue([
      {
        direction: Direction.CREDIT,
        _sum: { amount: new Prisma.Decimal(1000) },
      },
    ]);
    ledger.recordEntry.mockResolvedValue(undefined);
    tx.transfer.create.mockResolvedValue(completed);
    tx.idempotencyKey.update.mockResolvedValue(finished);
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<Transfer>) => {
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
        TransfersService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledger },
        { provide: WalletsService, useValue: wallets },
        { provide: Logger, useValue: logger },
        { provide: getQueueToken('notifications'), useValue: queue },
      ],
    }).compile();
    service = module.get(TransfersService);
  });

  it('locks in sorted order, preserves NGN amounts, balances entries and enqueues after commit', async () => {
    expect(await service.executeTransfer('user', dto, 'key')).toBe(completed);
    expect(tx.$queryRaw.mock.calls.map((call) => call[1])).toEqual([
      receiver.id,
      sender.id,
    ]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    const debit = ledger.recordEntry.mock.calls[0];
    const credit = ledger.recordEntry.mock.calls[1];
    expect(debit[0]).toBe(tx);
    expect(credit[0]).toBe(tx);
    expect(debit[1].amount.toString()).toBe('500');
    expect(debit[1].direction).toBe(Direction.DEBIT);
    expect(credit[1].direction).toBe(Direction.CREDIT);
    expect(debit[1].reference).toBe(credit[1].reference);
    expect(events).toEqual(['commit', 'queue']);
    expect(
      tx.idempotencyKey.update.mock.calls[0][0].data.responseBody.amount,
    ).toBe('500');
  });

  it.each([1.5, 500.1234])(
    'preserves fractional NGN amount %s',
    async (amount) => {
      await service.executeTransfer('user', { ...dto, amount }, 'key');
      expect(ledger.recordEntry.mock.calls[0][1].amount.toString()).toBe(
        String(amount),
      );
      expect(ledger.recordEntry.mock.calls[1][1].amount.toString()).toBe(
        String(amount),
      );
    },
  );

  it('replays a completed response with Decimal and Date types without another transaction', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(finished);
    const result = await service.executeTransfer('user', dto, 'key');
    expect(result.amount).toBeInstanceOf(Prisma.Decimal);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects in-progress requests', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(reservation);
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'already in progress',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['another-user', 'changed-body'])(
    'rejects key reuse for %s',
    async (kind) => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(finished);
      await expect(
        service.executeTransfer(
          kind === 'another-user' ? 'other' : 'user',
          kind === 'changed-body' ? { ...dto, amount: 6000 } : dto,
          'key',
        ),
      ).rejects.toThrow('bound to another request');
    },
  );

  it('handles a concurrent reservation losing the unique-key race', async () => {
    prisma.idempotencyKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(finished);
    prisma.idempotencyKey.create.mockRejectedValue({ code: 'P2002' });
    expect((await service.executeTransfer('user', dto, 'key')).id).toBe(
      completed.id,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses the transactional balance rather than the external wallet balance', async () => {
    tx.ledgerEntry.groupBy.mockResolvedValue([]);
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'Insufficient balance',
    );
    expect(ledger.recordEntry).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { id: reservation.id, status: 'STARTED' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not queue notifications when a credit fails', async () => {
    ledger.recordEntry
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('credit failed'));
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'credit failed',
    );
    expect(tx.transfer.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retries serialization conflicts', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    expect(await service.executeTransfer('user', dto, 'key')).toBe(completed);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('does not report a committed transfer as failed when Redis is unavailable', async () => {
    queue.add.mockRejectedValue(new Error('Redis unavailable'));
    expect(await service.executeTransfer('user', dto, 'key')).toBe(completed);
    expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 1.00001, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid NGN amount %s',
    async (amount) => {
      await expect(
        service.executeTransfer('user', { ...dto, amount }, 'key'),
      ).rejects.toThrow('Amount must be at least 1 NGN');
      expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    },
  );

  it('rejects same-wallet transfers', async () => {
    await expect(
      service.executeTransfer(
        'user',
        { ...dto, receiverWalletId: sender.id },
        'key',
      ),
    ).rejects.toThrow('same wallet');
    expect(ledger.recordEntry).not.toHaveBeenCalled();
  });

  it('rejects inactive receivers', async () => {
    tx.$queryRaw.mockImplementation(
      async (_strings: TemplateStringsArray, id: string) => [
        id === sender.id
          ? sender
          : { ...receiver, status: WalletStatus.FROZEN },
      ],
    );
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'must be active',
    );
  });

  it('paginates only transfers involving the user wallets', async () => {
    prisma.transfer.findMany.mockResolvedValue([
      completed,
      { ...completed, id: 'next' },
    ]);
    const result = await service.findAllForUser('user', 1);
    expect(result.pagination).toEqual({
      nextCursor: completed.id,
      hasNextPage: true,
      limit: 1,
    });
    expect(prisma.transfer.findMany.mock.calls[0][0].where.OR).toEqual([
      { senderWalletId: { in: [sender.id] } },
      { receiverWalletId: { in: [sender.id] } },
    ]);
  });

  it('returns 404 for inaccessible transfers and cursors', async () => {
    prisma.transfer.findFirst.mockResolvedValue(null);
    await expect(service.findOneForUser('missing', 'user')).rejects.toThrow(
      'Transfer not found',
    );
    await expect(
      service.findAllForUser('user', 20, 'foreign-cursor'),
    ).rejects.toThrow('cursor not found');
  });

  it('requires an idempotency key and an existing sender wallet', async () => {
    await expect(service.executeTransfer('user', dto, '')).rejects.toThrow(
      'header is required',
    );
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'Wallet not found',
    );
  });
  it('propagates reservation failures and detects vanished race winners', async () => {
    prisma.idempotencyKey.create.mockRejectedValueOnce(new Error('offline'));
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'offline',
    );
    prisma.idempotencyKey.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toEqual({
      code: 'P2002',
    });
  });
  it('rejects vanished receiver rows and currency mismatches', async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'Wallet not found',
    );
    tx.$queryRaw.mockImplementation(
      async (_sql: TemplateStringsArray, id: string) => [
        id === sender.id ? sender : { ...receiver, currency: 'USD' },
      ],
    );
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'must use NGN',
    );
  });
  it('includes debits and null sums in the locked balance', async () => {
    tx.ledgerEntry.groupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amount: null } },
      { direction: 'DEBIT', _sum: { amount: new Prisma.Decimal(1) } },
    ]);
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toThrow(
      'Insufficient balance',
    );
  });
  it('stops retrying conflicts and preserves the original error if cleanup also fails', async () => {
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    prisma.idempotencyKey.deleteMany.mockRejectedValue(
      new Error('cleanup failed'),
    );
    await expect(service.executeTransfer('user', dto, 'key')).rejects.toEqual({
      code: 'P2034',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
  it('validates page sizes and handles valid final cursors', async () => {
    await expect(service.findAllForUser('user', 0)).rejects.toThrow('Limit');
    prisma.transfer.findFirst.mockResolvedValue(completed);
    prisma.transfer.findMany.mockResolvedValue([completed]);
    expect(
      (await service.findAllForUser('user', 20, completed.id)).pagination
        .nextCursor,
    ).toBeNull();
    expect(await service.findOneForUser(completed.id, 'user')).toBe(completed);
  });
});

function mockFn(implementation?: (...args: never[]) => unknown): jest.Mock {
  const fn = createMock<{ fn: jest.Mock }>().fn;
  if (implementation) fn.mockImplementation(implementation);
  return fn;
}
