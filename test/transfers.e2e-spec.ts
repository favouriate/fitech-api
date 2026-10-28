import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import {
  createApp,
  createWallet,
  registerAndLogin,
  walletSchema,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Transfers: atomic money movement and idempotency', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('conserves balances and rejects retries, overdrafts, and unrelated readers correctly', async () => {
    const alice = await registerAndLogin(app);
    const bob = await registerAndLogin(app);
    const outsider = await registerAndLogin(app);
    const aliceWallet = await createWallet(app, alice.accessToken);
    const bobWallet = await createWallet(app, bob.accessToken);
    const prisma = app.get(PrismaService);
    await prisma.$transaction((tx) =>
      app.get(LedgerService).recordEntry(tx, {
        walletId: aliceWallet,
        amount: 10_000,
        direction: 'CREDIT',
        reference: `seed-${randomUUID()}`,
      }),
    );
    const key = randomUUID();
    const body = { receiverWalletId: bobWallet, amount: '500' };
    const transferred = await request(app.getHttpServer())
      .post('/v1/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);
    const transfer = z
      .object({ id: z.string(), reference: z.string() })
      .parse(transferred.body);
    const replay = await request(app.getHttpServer())
      .post('/v1/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);
    expect(replay.body).toEqual(transferred.body);
    for (const [token, balance] of [
      [alice.accessToken, '9500.0000'],
      [bob.accessToken, '500.0000'],
    ] as const) {
      const wallet = await request(app.getHttpServer())
        .get('/v1/wallets/me')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(walletSchema.parse(wallet.body).balance).toBe(balance);
    }
    expect(
      await prisma.ledgerEntry.count({
        where: { reference: transfer.reference },
      }),
    ).toBe(2);
    const before = await prisma.ledgerEntry.count();
    await request(app.getHttpServer())
      .post('/v1/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, amount: '99999' })
      .expect(400);
    expect(await prisma.ledgerEntry.count()).toBe(before);
    // Both participants may read their transfer; only unrelated users get 404.
    await request(app.getHttpServer())
      .get(`/v1/transfers/${transfer.id}`)
      .auth(alice.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/transfers/${transfer.id}`)
      .auth(bob.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/transfers/${transfer.id}`)
      .auth(outsider.accessToken, { type: 'bearer' })
      .expect(404);
  });
});
