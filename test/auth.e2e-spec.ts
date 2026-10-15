import request from 'supertest';
import {
  createApp,
  password,
  registerAndLogin,
  tokensSchema,
} from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Auth lifecycle (real PostgreSQL and Redis)', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registers, logs in, rotates tokens, logs out, and revokes all sessions', async () => {
    const user = await registerAndLogin(app);
    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    const tokens = tokensSchema.parse(rotated.body).tokens;
    expect(tokens.refreshToken).not.toBe(user.refreshToken);
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    const nextLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, password })
      .expect(200);
    const next = tokensSchema.parse(nextLogin.body).tokens;
    await request(app.getHttpServer())
      .post('/v1/auth/logout-all')
      .auth(next.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: next.refreshToken })
      .expect(401);
  });

  it('detects reuse of a rotated token and revokes the replacement session', async () => {
    const user = await registerAndLogin(app);
    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    const tokens = tokensSchema.parse(rotated.body).tokens;
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });
});
