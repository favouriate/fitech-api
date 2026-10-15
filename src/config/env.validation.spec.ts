import { envSchema } from './env.validation.js';
import appConfig from './app.config.js';
import jwtConfig from './jwt.config.js';
import redisConfig from './redis.config.js';
import throttlerConfig from './throttler.config.js';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  JWT_ACCESS_SECRET: 'test-secret-at-least-32-characters-long',
  WEBHOOK_SECRET: 'test-webhook-at-least-16',
};

describe('Environment validation and registered configuration', () => {
  it('retains the webhook secret and applies safe defaults', () => {
    expect(envSchema.parse(valid)).toEqual(
      expect.objectContaining({
        WEBHOOK_SECRET: valid.WEBHOOK_SECRET,
        PORT: 3000,
        REDIS_PORT: 6379,
      }),
    );
    expect(
      envSchema.parse({
        ...valid,
        ALLOWED_ORIGINS: ' http://a.test, ,http://b.test ',
      }).ALLOWED_ORIGINS,
    ).toEqual(['http://a.test', 'http://b.test']);
  });
  it.each([
    { DATABASE_URL: 'https://not-postgres.test' },
    { PORT: 70000 },
    { JWT_ACCESS_SECRET: 'short' },
    { WEBHOOK_SECRET: 'short' },
    { JWT_ACCESS_EXPIRES_IN: 'nonsense' },
    { JWT_REFRESH_EXPIRES_IN: '0ms' },
  ])('rejects invalid environment input %j', (invalid) => {
    expect(envSchema.safeParse({ ...valid, ...invalid }).success).toBe(false);
  });
  it('exposes application, JWT, Redis and throttle configuration', () => {
    const prior = { ...process.env };
    try {
      delete process.env.PORT;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      expect(appConfig()).toBeDefined();
      expect(jwtConfig()).toBeDefined();
      expect(redisConfig()).toEqual({ host: 'localhost', port: 6379 });
      expect(throttlerConfig().throttlers).toHaveLength(4);
      process.env.PORT = '3456';
      process.env.REDIS_HOST = 'redis';
      process.env.REDIS_PORT = '6380';
      expect(appConfig().port).toBe(3456);
      expect(redisConfig()).toEqual({ host: 'redis', port: 6380 });
    } finally {
      process.env = prior;
    }
  });
});
