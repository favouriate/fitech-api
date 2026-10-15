import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

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
