import request from 'supertest';
import {
  createApp,
  createWallet,
  registerAndLogin,
  walletSchema,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Wallet authorization and balances', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('creates one wallet, rejects duplicates, derives zero balance and conceals other users wallets', async () => {
    const alice = await registerAndLogin(app);
    const bob = await registerAndLogin(app);
    const walletId = await createWallet(app, alice.accessToken);
    await request(app.getHttpServer())
      .post('/v1/wallets')
      .auth(alice.accessToken, { type: 'bearer' })
      .send({ currency: 'NGN' })
      .expect(409);
    const mine = await request(app.getHttpServer())
      .get('/v1/wallets/me')
      .auth(alice.accessToken, { type: 'bearer' })
      .expect(200);
    expect(walletSchema.parse(mine.body)).toEqual({ id: walletId, balance: 0 });
    await request(app.getHttpServer())
      .get(`/v1/wallets/${walletId}`)
      .auth(bob.accessToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/v1/wallets/${walletId}/ledger`)
      .auth(bob.accessToken, { type: 'bearer' })
      .expect(404);
  });
});
