import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(
  app: INestApplication,
  config: ConfigService,
): void {
  const nodeEnv = config.get<string>('app.nodeEnv') ?? 'development';

  // Skip Swagger entirely in production — do not leak API surface.
  if (nodeEnv === 'production') {
    return;
  }

  const documentBuilder = new DocumentBuilder()
    .setTitle('Fitech API')
    .setDescription(
      [
        'Production-grade fintech API.',
        '',
        '**Architecture:** Ledger-based (append-only) with derived balances.',
        '**Auth:** JWT access tokens (15m) + opaque refresh tokens (7d, rotated).',
        '**Idempotency:** All money movement requires an Idempotency-Key header.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .addServer('http://localhost:3000', 'Local development')
    .addTag('Auth', 'Authentication & session management')
    .addTag('Wallets', 'Wallet operations & balances')
    .addTag('Transfers', 'Money movement (idempotent)')
    .addTag('Health', 'Liveness & readiness probes');

  const documentConfig = documentBuilder.build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('docs', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
    },
    customSiteTitle: 'Fitech API Documentation',
  });
}
