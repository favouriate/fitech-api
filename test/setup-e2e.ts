import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type {} from './container-state.js';

export default async function setup(): Promise<void> {
  const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  let redis: Awaited<ReturnType<RedisContainer['start']>> | undefined;
  try {
    redis = await new RedisContainer('redis:7-alpine').start();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getPort()}`,
      REDIS_HOST: redis.getHost(),
      REDIS_PORT: String(redis.getPort()),
      JWT_ACCESS_SECRET: 'e2e-only-access-secret-at-least-32-characters',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      WEBHOOK_SECRET: 'e2e-only-webhook-secret-32-characters',
      SENTRY_DSN: '',
    });
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
      ],
      {
        cwd: resolve(__dirname, '..'),
        env: process.env,
        stdio: 'pipe',
        timeout: 60_000,
      },
    );
    globalThis.__e2eContainers = { postgres, redis };
  } catch (error: unknown) {
    await Promise.allSettled([
      postgres.stop(),
      ...(redis ? [redis.stop()] : []),
    ]);
    throw error;
  }
}
