import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FundingStatus } from '@prisma/client';
import type { WebhookEvent } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FundingService } from '../funding/funding.service.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

const secret = 'test-webhook-secret';
const reference = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const payload = {
  eventId: 'evt_123',
  eventType: 'funding.completed',
  data: { reference, amount: 500 },
};
const event: WebhookEvent = {
  id: 'event',
  eventId: payload.eventId,
  provider: 'SIMULATED',
  eventType: payload.eventType,
  payload,
  status: 'PENDING',
  error: null,
  createdAt: new Date(),
  processedAt: null,
};

describe('WebhooksService and signature ordering', () => {
  let service: WebhooksService;
  let app: INestApplication;
  const tx = { webhookEvent: { create: vi.fn() } };
  const prisma = {
    $transaction: vi.fn(),
    webhookEvent: { findUnique: vi.fn(), update: vi.fn() },
    funding: { findUnique: vi.fn() },
  };
  const funding = { confirmFunding: vi.fn() };
  const config = { getOrThrow: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    config.getOrThrow.mockReturnValue(secret);
    tx.webhookEvent.create.mockResolvedValue(event);
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<WebhookEvent>) =>
        callback(tx),
    );
    prisma.webhookEvent.findUnique.mockResolvedValue({
      ...event,
      status: 'PROCESSED',
    });
    prisma.webhookEvent.update.mockResolvedValue({
      ...event,
      status: 'PROCESSED',
    });
    prisma.funding.findUnique.mockResolvedValue({
      reference,
      status: FundingStatus.PENDING,
    });
    funding.confirmFunding.mockResolvedValue({
      reference,
      status: FundingStatus.COMPLETED,
    });
    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        WebhooksService,
        WebhookSignatureGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: FundingService, useValue: funding },
        { provide: ConfigService, useValue: config },
        {
          provide: Logger,
          useValue: {
            log: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(WebhooksService);
    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('verifies exact raw bytes and rejects malformed signatures', () => {
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(service.verifySignature(raw, signature)).toBe(true);
    expect(service.verifySignature(raw, `sha256=${signature}`)).toBe(true);
    expect(service.verifySignature(raw, `${signature}ZZ`)).toBe(false);
    expect(service.verifySignature(undefined, signature)).toBe(false);
    expect(service.verifySignature(raw, undefined)).toBe(false);
    expect(
      service.verifySignature(
        Buffer.concat([raw, Buffer.from(' ')]),
        signature,
      ),
    ).toBe(false);
    expect(service.verifySignature(raw, 'short')).toBe(false);
    expect(service.verifySignature(raw, 'z'.repeat(64))).toBe(false);
  });

  it('fails closed without throwing when the webhook secret is missing', () => {
    config.getOrThrow.mockImplementation(() => {
      throw new Error('Missing configuration');
    });
    expect(service.verifySignature(Buffer.from('{}'), '0'.repeat(64))).toBe(
      false,
    );
  });

  it('returns 401 before global DTO validation for unsigned invalid payloads', async () => {
    await request(app.getHttpServer())
      .post('/v1/webhooks/payment-provider')
      .send({ invalid: true })
      .expect(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 after signature verification for signed invalid DTOs', async () => {
    const raw = JSON.stringify({ invalid: true });
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    await request(app.getHttpServer())
      .post('/v1/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(raw)
      .expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts a signed event and confirms funding once', async () => {
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    await request(app.getHttpServer())
      .post('/v1/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(raw)
      .expect(200, { status: 'ok' });
    expect(funding.confirmFunding).toHaveBeenCalledOnce();
    expect(prisma.webhookEvent.update.mock.calls[0][0].data.status).toBe(
      'PROCESSED',
    );
  });

  it('reads duplicates outside the rolled-back transaction and never credits twice', async () => {
    tx.webhookEvent.create.mockRejectedValue({ code: 'P2002' });
    expect((await service.processEvent(payload)).status).toBe('PROCESSED');
    expect(prisma.webhookEvent.findUnique).toHaveBeenCalledWith({
      where: { eventId: payload.eventId },
    });
    expect(funding.confirmFunding).not.toHaveBeenCalled();
  });

  it('does not double-credit already completed funding for a new event ID', async () => {
    prisma.funding.findUnique.mockResolvedValue({
      reference,
      status: FundingStatus.COMPLETED,
    });
    await service.processEvent(payload);
    expect(funding.confirmFunding).not.toHaveBeenCalled();
  });

  it('records FAILED when funding confirmation fails', async () => {
    funding.confirmFunding.mockRejectedValue(new Error('credit failed'));
    await expect(service.processEvent(payload)).rejects.toThrow(
      'credit failed',
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { status: 'FAILED', error: 'credit failed' },
    });
  });

  it('retries serializable reservation conflicts', async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await service.processEvent(payload);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(funding.confirmFunding).toHaveBeenCalledOnce();
  });
});
