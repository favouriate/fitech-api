import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Prisma, WalletStatus } from '@prisma/client';
import type { LedgerEntry, Wallet } from '@prisma/client';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';

describe('Wallet response and authorization boundaries', () => {
  const service = createMock<WalletsService>();
  const controller = new WalletsController(service);
  const user = { id: 'user', email: 'test@example.com' };
  const wallet: Wallet = {
    id: 'wallet',
    userId: user.id,
    currency: 'NGN',
    status: WalletStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('returns the created wallet and exposes owned balances', async () => {
    service.create.mockResolvedValue(wallet);
    service.findByUser.mockResolvedValue({ ...wallet, balance: 500 });
    service.findOneForUser.mockResolvedValue({ ...wallet, balance: 500 });
    expect((await controller.create(user, { currency: 'NGN' })).balance).toBe(
      0,
    );
    expect((await controller.mine(user))?.balance).toBe(500);
    expect((await controller.findOne(wallet.id, user)).balance).toBe(500);
  });
  it('does not fetch ledger entries for another users wallet', async () => {
    service.findOneForUser.mockRejectedValue(new NotFoundException());
    await expect(controller.getLedger('other', {}, user)).rejects.toThrow();
    expect(service.getLedgerEntries).not.toHaveBeenCalled();
  });
  it('preserves decimal-string precision and normalizes nullable metadata', async () => {
    service.findOneForUser.mockResolvedValue({ ...wallet, balance: 0 });
    const base: LedgerEntry = {
      id: 'entry',
      walletId: wallet.id,
      amount: new Prisma.Decimal('500.1234'),
      direction: 'CREDIT',
      reference: 'ref',
      description: null,
      metadata: null,
      createdAt: new Date(),
    };
    service.getLedgerEntries.mockResolvedValue({
      data: [
        base,
        { ...base, metadata: { test: true } },
        { ...base, metadata: [] },
        { ...base, metadata: 'text' },
      ],
      pagination: { nextCursor: null, hasNextPage: false, limit: 20 },
    });
    const result = await controller.getLedger(wallet.id, {}, user);
    expect(result.data.map((entry) => entry.amount)).toEqual([
      '500.1234',
      '500.1234',
      '500.1234',
      '500.1234',
    ]);
    expect(result.data.map((entry) => entry.metadata)).toEqual([
      null,
      { test: true },
      null,
      null,
    ]);
    await controller.getLedger(wallet.id, { limit: 5, cursor: 'cursor' }, user);
    expect(service.getLedgerEntries).toHaveBeenLastCalledWith(
      wallet.id,
      'cursor',
      5,
    );
  });
});
