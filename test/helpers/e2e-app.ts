import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';

export type E2eApp = INestApplication<Server>;
export const password = 'E2e!TestPassword123';
export const tokensSchema = z.object({
  tokens: z.object({ accessToken: z.string(), refreshToken: z.string() }),
});
export const walletSchema = z.object({ id: z.string(), balance: z.number() });

export async function createApp(): Promise<E2eApp> {
  if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
    throw new Error('Run through the Testcontainers E2E config');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue({ throttlers: [], skipIf: () => true })
    .compile();
  const app = module.createNestApplication<E2eApp>({ rawBody: true });
  app.useLogger(false);
  app.setGlobalPrefix('v1', {
    exclude: ['health', 'docs', 'docs-json', 'metrics'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );
  try {
    await app.init();
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
  return app;
}

export async function registerAndLogin(app: E2eApp): Promise<{
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}> {
  const email = `e2e-${randomUUID()}@example.com`;
  const registered = await request(app.getHttpServer())
    .post('/v1/auth/register')
    .send({ email, password, firstName: 'Test', lastName: 'User' })
    .expect(201);
  const user = z.object({ id: z.string() }).parse(registered.body);
  const login = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return { ...user, email, ...tokensSchema.parse(login.body).tokens };
}

export async function createWallet(
  app: E2eApp,
  accessToken: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/v1/wallets')
    .auth(accessToken, { type: 'bearer' })
    .send({ currency: 'NGN' })
    .expect(201);
  return walletSchema.parse(response.body).id;
}
