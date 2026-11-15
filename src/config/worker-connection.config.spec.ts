import { Reflector } from '@nestjs/core';
import type { NestWorkerOptions } from '@nestjs/bullmq';
import { ReconciliationProcessor } from '../modules/funding/reconciliation.processor.js';
import { NotificationsProcessor } from '../modules/notifications/notifications.processor.js';

describe.each([NotificationsProcessor, ReconciliationProcessor])(
  '%s Redis connection',
  (ProcessorClass) => {
    it('resolves the configured URL at worker registration and waits for Redis', () => {
      const previousUrl = process.env.REDIS_URL;
      try {
        // Processor decorators have already executed before this value is set.
        process.env.REDIS_URL = 'redis://localhost:6380/2';
        const options = new Reflector().get<NestWorkerOptions>(
          'bullmq:worker_metadata',
          ProcessorClass,
        );
        expect(options.connection).toEqual({
          url: process.env.REDIS_URL,
          maxRetriesPerRequest: null,
        });
        expect(options.connection).not.toHaveProperty(
          'enableOfflineQueue',
          false,
        );
      } finally {
        if (previousUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = previousUrl;
      }
    });
  },
);
