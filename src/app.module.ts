import { Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import appConfig from './config/app.config.js';
import jwtConfig from './config/jwt.config.js';
import redisConfig from './config/redis.config.js';
import throttlerConfig from './config/throttler.config.js';
import { validateEnv } from './config/env.validation.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';

import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { TransfersModule } from './modules/transfers/transfers.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FundingModule } from './modules/funding/funding.module.js';
import { Queue } from 'bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { MetricsInterceptor } from './modules/metrics/metrics.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  imports: [
    SentryModule.forRoot(),
    MetricsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env'],
      load: [appConfig, jwtConfig, redisConfig, throttlerConfig],
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get('app.nodeEnv') === 'production';
        return {
          pinoHttp: {
            level: isProduction ? 'info' : 'debug',
            genReqId: (req) =>
              (req.headers['x-correlation-id'] as string) ?? randomUUID(),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname',
                  },
                },
            customLogLevel: (_req, res, err) => {
              if (res.statusCode >= 500 || err) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            autoLogging: {
              ignore: (req) => req.url === '/health',
            },
          },
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: config.get('throttler.throttlers') ?? [],
      }),
    }),

    PrismaModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
          password: process.env.REDIS_PASSWORD,
          tls: {
            servername: process.env.REDIS_HOST,
            rejectUnauthorized: false,
          },
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => Math.min(times * 50, 2000),
        },
      }),
    }),
    HealthModule,
    AuthModule,
    LedgerModule,
    WalletsModule,
    TransfersModule,
    FundingModule,
    NotificationsModule,
    WebhooksModule,
  ],
  providers: [
    Logger,
    { provide: SentryGlobalFilter, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useExisting: SentryGlobalFilter },
    { provide: APP_INTERCEPTOR, useExisting: MetricsInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    @InjectQueue('funding-reconciliation')
    private readonly fundingReconciliationQueue: Queue<Record<string, never>>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.fundingReconciliationQueue.upsertJobScheduler(
      'funding-reconciliation-singleton',
      { pattern: '*/5 * * * *' },
      {
        name: 'expire-stale-fundings',
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 50 },
      },
    );
  }
}
