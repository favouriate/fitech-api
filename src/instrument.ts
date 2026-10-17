import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import * as Sentry from '@sentry/nestjs';

const otelSdk = new NodeSDK({
  serviceName: 'fitech-api',
  traceExporter: new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

otelSdk.start();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers) {
        for (const key of Object.keys(event.request.headers)) {
          if (
            [
              'authorization',
              'cookie',
              'x-api-key',
              'x-webhook-signature',
            ].includes(key.toLowerCase())
          ) {
            delete event.request.headers[key];
          }
        }
      }
    }
    return event;
  },
});
