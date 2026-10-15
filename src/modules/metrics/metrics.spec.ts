import { createMock } from '@golevelup/ts-jest';
import { Controller, Get, Logger, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import request from 'supertest';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter.js';
import { MetricsModule } from './metrics.module.js';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { BusinessMetricsService } from './business-metrics.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { Public } from '../../common/decorators/public.decorator.js';

@Public()
@Controller('metrics-test')
class MetricsTestController {
  @Get(':id')
  get(): { ok: boolean } {
    return { ok: true };
  }

  @Get(':id/fail')
  fail(): never {
    throw new NotFoundException('Test resource missing');
  }

  @Get(':id/internal')
  internal(): never {
    throw new Error('private database details');
  }
}

@Controller('protected-test')
class ProtectedTestController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

describe('Metrics and error responses', () => {
  let app: INestApplication;
  let business: BusinessMetricsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [MetricsModule],
      controllers: [MetricsTestController, ProtectedTestController],
      providers: [
        { provide: Logger, useValue: { error: mockFn(), warn: mockFn() } },
        { provide: SentryGlobalFilter, useClass: AllExceptionsFilter },
        { provide: APP_FILTER, useExisting: SentryGlobalFilter },
        { provide: APP_INTERCEPTOR, useExisting: MetricsInterceptor },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: JwtService, useValue: { verifyAsync: mockFn() } },
        { provide: ConfigService, useValue: { getOrThrow: mockFn() } },
      ],
    }).compile();
    business = module.get(BusinessMetricsService);
    app = module.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['metrics'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes metrics outside the global prefix with normalized route and final status', async () => {
    await request(app.getHttpServer()).get('/v1/metrics-test/123').expect(200);
    await request(app.getHttpServer())
      .get('/v1/metrics-test/123/fail')
      .expect(404);
    const metrics = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);
    expect(metrics.text).toContain('http_server_requests_seconds_count');
    expect(metrics.text).toContain(
      'route="/v1/metrics-test/:id/fail",status_code="404"',
    );
    expect(metrics.text).toContain('http_errors_total');
  });

  it('allows unauthenticated metrics while retaining JWT protection elsewhere', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(200);
    await request(app.getHttpServer()).get('/v1/protected-test').expect(401);
  });

  it('returns standard responses and hides internal exception details', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/metrics-test/123/internal')
      .expect(500);
    expect(response.body.message).toBe('Internal server error');
    expect(response.text).not.toContain('private database');
  });

  it('exports and increments business counters', async () => {
    business.recordTransfer('success');
    business.recordTransfer('failed');
    business.recordFundingInitiated();
    business.recordFundingCompleted();
    const metrics = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);
    expect(metrics.text).toContain('transfers_total{status="success"} 1');
    expect(metrics.text).toContain('transfers_total{status="failed"} 1');
    expect(metrics.text).toContain('funding_initiated_total 1');
    expect(metrics.text).toContain('funding_completed_total 1');
  });
});

function mockFn(implementation?: (...args: never[]) => unknown): jest.Mock {
  const fn = createMock<{ fn: jest.Mock }>().fn;
  if (implementation) fn.mockImplementation(implementation);
  return fn;
}
