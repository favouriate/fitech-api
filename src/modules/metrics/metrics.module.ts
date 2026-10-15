import { Global, Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { BusinessMetricsService } from './business-metrics.service.js';
import { MetricsController } from './metrics.controller.js';

const metricProviders = [
  makeHistogramProvider({
    name: 'http_server_requests_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeCounterProvider({
    name: 'http_errors_total',
    help: 'HTTP errors',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeCounterProvider({
    name: 'transfers_total',
    help: 'Transfer execution outcomes',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: 'funding_initiated_total',
    help: 'Funding initiations',
  }),
  makeCounterProvider({
    name: 'funding_completed_total',
    help: 'Committed funding credits',
  }),
];

@Global()
@Module({
  imports: [PrometheusModule.register({ controller: MetricsController })],
  providers: [MetricsInterceptor, BusinessMetricsService, ...metricProviders],
  exports: [MetricsInterceptor, BusinessMetricsService, ...metricProviders],
})
export class MetricsModule {}
