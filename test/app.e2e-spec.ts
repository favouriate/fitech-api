import request from 'supertest';
import { createApp, registerAndLogin } from './helpers/e2e-app.js';
import type { E2eApp } from './helpers/e2e-app.js';

describe('Application boundaries', () => {
  let app: E2eApp;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('requires auth on protected routes', async () => {
    await request(app.getHttpServer()).get('/v1/auth/me').expect(401);
  });
  it('exposes health and metrics', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/metrics').expect(200);
  });
  it('validates public auth requests', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({})
      .expect(400);
  });
  it('never exposes password hashes', async () => {
    const user = await registerAndLogin(app);
    const response = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .auth(user.accessToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body.id).toBe(user.id);
  });
});
