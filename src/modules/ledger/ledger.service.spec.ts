import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from './ledger.service.js';

describe('LedgerService', () => {
  const prisma = createMock<PrismaService>();
  const groupBy = createMock<{ groupBy: jest.Mock }>().groupBy;
  prisma.ledgerEntry.groupBy = groupBy;
  const tx = createMock<Prisma.TransactionClient>();
  const service = new LedgerService(prisma, createMock<Logger>());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns zero for an empty wallet', async () => {
    groupBy.mockResolvedValue([]);
    expect(await service.getBalance('wallet')).toBe(0);
  });

  it('computes credits minus debits', async () => {
    groupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amount: new Prisma.Decimal(10_000) } },
      { direction: 'DEBIT', _sum: { amount: new Prisma.Decimal(500) } },
    ]);
    expect(await service.getBalance('wallet')).toBe(9500);
  });

  it('returns a Map with zero balances for wallets without entries', async () => {
    groupBy.mockResolvedValue([]);
    const balances = await service.getBalances(['alice', 'bob']);
    expect(balances).toBeInstanceOf(Map);
    expect([...balances]).toEqual([
      ['alice', 0],
      ['bob', 0],
    ]);
    expect(prisma.ledgerEntry.groupBy).toHaveBeenCalledTimes(1);
  });

  it('aggregates all wallets in one query and leaves untouched wallets at zero', async () => {
    groupBy.mockResolvedValue([
      {
        walletId: 'alice',
        direction: 'CREDIT',
        _sum: { amount: new Prisma.Decimal(1000) },
      },
      {
        walletId: 'alice',
        direction: 'DEBIT',
        _sum: { amount: new Prisma.Decimal(100) },
      },
    ]);
    expect(await service.getBalances(['alice', 'bob'])).toEqual(
      new Map([
        ['alice', 900],
        ['bob', 0],
      ]),
    );
  });

  it('skips the database for an empty wallet list', async () => {
    expect(await service.getBalances([])).toEqual(new Map());
    expect(prisma.ledgerEntry.groupBy).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid amount %s',
    async (amount) => {
      await expect(
        service.recordEntry(tx, {
          walletId: 'wallet',
          amount,
          direction: 'CREDIT',
          reference: 'reference',
        }),
      ).rejects.toThrow('positive and finite');
      expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    },
  );

  it.each(['', '  '])('rejects empty references', async (reference) => {
    await expect(
      service.recordEntry(tx, {
        walletId: 'wallet',
        amount: 1,
        direction: 'CREDIT',
        reference,
      }),
    ).rejects.toThrow('reference is required');
  });

  it('writes a Decimal through the supplied transaction client', async () => {
    await service.recordEntry(tx, {
      walletId: 'wallet',
      amount: new Prisma.Decimal('500.1234'),
      direction: 'CREDIT',
      reference: 'reference',
      metadata: { test: true },
      description: 'test credit',
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: new Prisma.Decimal('500.1234') }),
    });
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });
});
