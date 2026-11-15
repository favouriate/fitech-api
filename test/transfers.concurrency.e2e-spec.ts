import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { z } from 'zod';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createApp,
  createWallet,
  registerAndLogin,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Concurrent transfers prevent double spending', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows only one of two simultaneous transfers to spend the same 500 NGN', async () => {
    const sender = await registerAndLogin(app);
    const receiverB = await registerAndLogin(app);
    const receiverC = await registerAndLogin(app);
    const senderWallet = await createWallet(app, sender.accessToken);
    const walletB = await createWallet(app, receiverB.accessToken);
    const walletC = await createWallet(app, receiverC.accessToken);
    const prisma = app.get(PrismaService);
    const ledger = app.get(LedgerService);

    await prisma.$transaction((tx) =>
      ledger.recordEntry(tx, {
        walletId: senderWallet,
        amount: new Prisma.Decimal('500.0000'),
        direction: 'CREDIT',
        reference: `seed-${randomUUID()}`,
      }),
    );

    // Distinct keys exercise balance contention, rather than idempotency deduplication.
    const responses = await Promise.all(
      [walletB, walletC].map((receiverWalletId) =>
        request(app.getHttpServer())
          .post('/v1/transfers')
          .auth(sender.accessToken, { type: 'bearer' })
          .set('Idempotency-Key', randomUUID())
          .send({ receiverWalletId, amount: '500.0000' }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      202, 400,
    ]);
    for (const response of responses) {
      if (response.status === 400) {
        expect(
          z.object({ message: z.string() }).parse(response.body).message,
        ).toBe('Insufficient balance');
      }
    }

    const balances = await ledger.getBalances([senderWallet, walletB, walletC]);
    expect(balances.get(senderWallet)?.toFixed(4)).toBe('0.0000');
    expect(
      [
        balances.get(walletB)?.toFixed(4),
        balances.get(walletC)?.toFixed(4),
      ].sort(),
    ).toEqual(['0.0000', '500.0000']);

    const debits = await prisma.ledgerEntry.findMany({
      where: { walletId: senderWallet, direction: 'DEBIT' },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]?.amount.toFixed(4)).toBe('500.0000');

    const transfers = await prisma.transfer.findMany({
      where: { senderWalletId: senderWallet },
    });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.status).toBe('COMPLETED');
    expect(transfers[0]?.reference).toBe(debits[0]?.reference);

    const credits = await prisma.ledgerEntry.findMany({
      where: { walletId: { in: [walletB, walletC] }, direction: 'CREDIT' },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]?.amount.toFixed(4)).toBe('500.0000');
    expect(credits[0]?.reference).toBe(debits[0]?.reference);
    expect(credits[0]?.walletId).toBe(transfers[0]?.receiverWalletId);
  });
});
