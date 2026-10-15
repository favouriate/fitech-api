import { createMock } from '@golevelup/ts-jest';
import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WalletStatus } from '@prisma/client';
import type { LedgerEntry, Wallet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from './wallets.service.js';

const wallet: Wallet = {
  id: 'wallet',
  userId: 'user',
  currency: 'NGN',
  status: WalletStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const entry: LedgerEntry = {
  id: 'entry',
  walletId: wallet.id,
  amount: new Prisma.Decimal(100),
  direction: 'CREDIT',
  reference: 'ref',
  description: null,
  metadata: null,
  createdAt: new Date(),
};

describe('WalletsService', () => {
  const prisma = createMock<PrismaService>();
  const ledger = createMock<LedgerService>();
  const service = new WalletsService(prisma, ledger, createMock<Logger>());
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('normalizes currency when creating a wallet', async () => {
    prisma.wallet.create.mockResolvedValue(wallet);
    expect(await service.create('user', 'ngn')).toEqual(wallet);
    expect(prisma.wallet.create).toHaveBeenCalledWith({
      data: { userId: 'user', currency: 'NGN' },
    });
  });
  it('translates P2002 to a conflict and rethrows other database errors', async () => {
    prisma.wallet.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.create('user', 'NGN')).rejects.toThrow(
      'You already have a wallet',
    );
    const error = new Error('offline');
    prisma.wallet.create.mockRejectedValueOnce(error);
    await expect(service.create('user', 'NGN')).rejects.toBe(error);
  });
  it('returns null for a missing wallet', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    expect(await service.findByUser('user')).toBeNull();
    expect(ledger.getBalance).not.toHaveBeenCalled();
  });
  it('derives the user wallet balance', async () => {
    prisma.wallet.findFirst.mockResolvedValue(wallet);
    ledger.getBalance.mockResolvedValue(100);
    expect(await service.findByUser('user')).toEqual({
      ...wallet,
      balance: 100,
    });
  });
  it('hides both missing and foreign wallets', async () => {
    prisma.wallet.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...wallet, userId: 'other' });
    await expect(
      service.findOneForUser('wallet', 'user'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOneForUser('wallet', 'user')).rejects.toThrow(
      'Wallet not found',
    );
    expect(ledger.getBalance).not.toHaveBeenCalled();
  });
  it('returns the owned wallet with a derived balance', async () => {
    prisma.wallet.findUnique.mockResolvedValue(wallet);
    ledger.getBalance.mockResolvedValue(100);
    expect(await service.findOneForUser('wallet', 'user')).toEqual({
      ...wallet,
      balance: 100,
    });
    expect(await service.findByIdUnsafe('wallet')).toEqual(wallet);
  });
  it('supports stable cursor pages and terminal empty pages', async () => {
    prisma.ledgerEntry.findMany
      .mockResolvedValueOnce([entry, { ...entry, id: 'extra' }])
      .mockResolvedValueOnce([]);
    expect(await service.getLedgerEntries('wallet', 'cursor', 1)).toEqual({
      data: [entry],
      pagination: { nextCursor: entry.id, hasNextPage: true, limit: 1 },
    });
    expect(prisma.ledgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 'cursor' },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(await service.getLedgerEntries('wallet', undefined, 20)).toEqual({
      data: [],
      pagination: { nextCursor: null, hasNextPage: false, limit: 20 },
    });
  });
});
