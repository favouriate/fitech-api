import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from './prisma/prisma.service.js';
import { HealthController } from './health/health.controller.js';

describe('Application module configuration and scheduling', () => {
  it.each(['development', 'production'])(
    'compiles %s wiring without contacting external services',
    async (environment) => {
      const before = { ...process.env };
      Object.assign(process.env, {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        JWT_ACCESS_SECRET: 'test-secret-at-least-32-characters-long',
        WEBHOOK_SECRET: 'test-webhook-at-least-16',
      });
      try {
        const { AppModule } = await import('./app.module.js');
        const config = createMock<ConfigService>();
        const values: Record<string, unknown> = {
          'app.nodeEnv': environment,
          'jwt.accessSecret': 'test-secret',
          'jwt.accessExpiresIn': '15m',
          'redis.host': 'localhost',
          'redis.port': 6379,
          'throttler.throttlers': [{ name: 'short', limit: 100, ttl: 1000 }],
        };
        const get = createMock<{ read: jest.Mock }>().read;
        if (environment === 'production') {
          delete values['redis.host'];
          delete values['redis.port'];
          delete values['throttler.throttlers'];
        }
        get.mockImplementation((key: string) => values[key]);
        config.get = get;
        config.getOrThrow = get;
        const queue = createMock<Queue>();
        queue.upsertJobScheduler.mockResolvedValue(
          createMock<Awaited<ReturnType<Queue['upsertJobScheduler']>>>(),
        );
        const module = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(ConfigService)
          .useValue(config)
          .overrideProvider(PrismaService)
          .useValue(createMock<PrismaService>({ ping: async () => undefined }))
          .overrideProvider(getQueueToken('notifications'))
          .useValue(createMock<Queue>())
          .overrideProvider(getQueueToken('funding-reconciliation'))
          .useValue(queue)
          .compile();
        try {
          const logging = module.get<{
            pinoHttp: {
              genReqId: (req: { headers: Record<string, string> }) => string;
              customLogLevel: (
                req: unknown,
                res: { statusCode: number },
                error?: Error,
              ) => string;
              autoLogging: { ignore: (req: { url: string }) => boolean };
            };
          }>('pino-params').pinoHttp;
          expect(
            logging.genReqId({ headers: { 'x-correlation-id': 'request-id' } }),
          ).toBe('request-id');
          expect(logging.genReqId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
          expect(logging.customLogLevel({}, { statusCode: 500 })).toBe('error');
          expect(
            logging.customLogLevel(
              {},
              { statusCode: 200 },
              new Error('failed'),
            ),
          ).toBe('error');
          expect(logging.customLogLevel({}, { statusCode: 400 })).toBe('warn');
          expect(logging.customLogLevel({}, { statusCode: 200 })).toBe('info');
          expect(logging.autoLogging.ignore({ url: '/health' })).toBe(true);
          expect(logging.autoLogging.ignore({ url: '/other' })).toBe(false);
          await module.get(AppModule).onModuleInit();
          await expect(
            module.get(HealthController).check(),
          ).resolves.toMatchObject({ status: 'ok' });
          expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'funding-reconciliation-singleton',
            { pattern: '*/5 * * * *' },
            expect.objectContaining({ name: 'expire-stale-fundings' }),
          );
        } finally {
          await module.close();
        }
      } finally {
        process.env = before;
      }
    },
  );
});
