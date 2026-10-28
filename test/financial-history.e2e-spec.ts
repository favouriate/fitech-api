import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createApp,
  createWallet,
  registerAndLogin,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Financial history foreign keys', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('prevents deleting users with wallets and wallets with ledger entries', async () => {
    const user = await registerAndLogin(app);
    const walletId = await createWallet(app, user.accessToken);
    const prisma = app.get(PrismaService);
    const entry = await prisma.ledgerEntry.create({
      data: {
        walletId,
        amount: new Prisma.Decimal('1.0001'),
        direction: 'CREDIT',
        reference: `history-${randomUUID()}`,
      },
    });

    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.wallet.delete({ where: { id: walletId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(
      await prisma.ledgerEntry.findUnique({ where: { id: entry.id } }),
    ).not.toBeNull();
  });
});
