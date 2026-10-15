import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createApp,
  createWallet,
  registerAndLogin,
  walletSchema,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

const fundingSchema = z.object({ reference: z.string(), status: z.string() });

describe('Funding lifecycle and HMAC callbacks', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('credits only on confirmation and rejects double confirmation', async () => {
    const user = await registerAndLogin(app);
    await createWallet(app, user.accessToken);
    const initiated = await request(app.getHttpServer())
      .post('/v1/funding/initiate')
      .auth(user.accessToken, { type: 'bearer' })
      .send({ amount: 500 })
      .expect(201);
    const funding = fundingSchema.parse(initiated.body);
    expect(funding.status).toBe('PENDING');
    const before = await request(app.getHttpServer())
      .get('/v1/wallets/me')
      .auth(user.accessToken, { type: 'bearer' })
      .expect(200);
    expect(walletSchema.parse(before.body).balance).toBe(0);
    const confirmed = await request(app.getHttpServer())
      .post(`/v1/funding/${funding.reference}/simulate-confirm`)
      .auth(user.accessToken, { type: 'bearer' })
      .expect(200);
    expect(fundingSchema.parse(confirmed.body).status).toBe('COMPLETED');
    const after = await request(app.getHttpServer())
      .get('/v1/wallets/me')
      .auth(user.accessToken, { type: 'bearer' })
      .expect(200);
    expect(walletSchema.parse(after.body).balance).toBe(500);
    await request(app.getHttpServer())
      .post(`/v1/funding/${funding.reference}/simulate-confirm`)
      .auth(user.accessToken, { type: 'bearer' })
      .expect(409);
  });

  it('accepts a signed webhook once and never duplicates the ledger credit on replay', async () => {
    const user = await registerAndLogin(app);
    const walletId = await createWallet(app, user.accessToken);
    const response = await request(app.getHttpServer())
      .post('/v1/funding/initiate')
      .auth(user.accessToken, { type: 'bearer' })
      .send({ amount: 3000 })
      .expect(201);
    const funding = fundingSchema.parse(response.body);
    const eventId = randomUUID();
    const payload = JSON.stringify({
      eventId,
      eventType: 'funding.completed',
      data: { reference: funding.reference, amount: 3000 },
    });
    const signature = createHmac('sha256', process.env.WEBHOOK_SECRET ?? '')
      .update(payload)
      .digest('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer())
        .post('/v1/webhooks/payment-provider')
        .set('Content-Type', 'application/json')
        .set('x-webhook-signature', signature)
        .send(payload)
        .expect(200);
    }
    const prisma = app.get(PrismaService);
    expect(
      (
        await prisma.funding.findUniqueOrThrow({
          where: { reference: funding.reference },
        })
      ).status,
    ).toBe('COMPLETED');
    expect(await prisma.webhookEvent.count({ where: { eventId } })).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          walletId,
          reference: `FUND-${funding.reference}`,
          direction: 'CREDIT',
        },
      }),
    ).toBe(1);
    const wallet = await request(app.getHttpServer())
      .get('/v1/wallets/me')
      .auth(user.accessToken, { type: 'bearer' })
      .expect(200);
    expect(walletSchema.parse(wallet.body).balance).toBe(3000);
  });
});
