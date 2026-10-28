import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FundingStatus, Prisma } from '@prisma/client';
import type { WebhookEvent } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FundingService } from '../funding/funding.service.js';
import { WebhookPayloadDto } from './dto/webhook-payload.dto.js';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fundingService: FundingService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    if (!rawBody || !Buffer.isBuffer(rawBody) || !signature) return false;
    let secret: string;
    try {
      secret = this.config.getOrThrow<string>('WEBHOOK_SECRET');
    } catch {
      this.logger.error('WEBHOOK_SECRET is not configured');
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    // Strip optional "sha256=" prefix
    const provided = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;
    if (!/^[a-fA-F0-9]{64}$/.test(provided)) {
      return false;
    }

    const providedBuf = Buffer.from(provided, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (providedBuf.length !== expectedBuf.length) return false;
    const match = timingSafeEqual(providedBuf, expectedBuf);
    return match;
  }

  async processEvent(payload: WebhookPayloadDto): Promise<WebhookEvent> {
    this.logger.debug(
      `Processing event ${payload.eventId} type=${payload.eventType}`,
    );
    try {
      // Round-trip validated JSON rather than asserting unknown data is Prisma JSON.
      const storedPayload: Prisma.InputJsonObject = JSON.parse(
        JSON.stringify(payload),
      ) as Prisma.InputJsonObject;
      let event: WebhookEvent | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          event = await this.prisma.$transaction(
            async (tx) => {
              this.logger.debug('Inside webhook reservation transaction');
              return tx.webhookEvent.create({
                data: {
                  eventId: payload.eventId,
                  eventType: payload.eventType,
                  payload: storedPayload,
                  status: 'PENDING',
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
          this.logger.debug('Webhook reservation transaction complete');
          break;
        } catch (error: unknown) {
          // A uniqueness violation aborts the PostgreSQL transaction. Read the
          // winner only after rollback, not from the failed transaction client.
          if (hasCode(error, 'P2002')) {
            const existing = await this.prisma.webhookEvent.findUnique({
              where: { eventId: payload.eventId },
            });
            if (!existing) throw error;
            const previous = existing.payload as Record<string, unknown>;
            const previousData = previous.data as
              Record<string, unknown> | undefined;
            if (
              existing.eventType !== payload.eventType ||
              previousData?.reference !== payload.data.reference ||
              previousData?.amount !== payload.data.amount ||
              previousData?.currency !== payload.data.currency
            ) {
              throw new ConflictException(
                'Webhook event ID is bound to another event',
              );
            }
            if (existing.status === 'PROCESSED') return existing;
            event = existing;
            break;
          }
          if (!hasCode(error, 'P2034') || attempt === 2) throw error;
        }
      }
      if (!event) throw new Error('Webhook reservation did not complete');
      try {
        if (payload.eventType === 'funding.completed') {
          const reference = payload.data.reference;
          if (typeof reference !== 'string' || !isUUID(reference)) {
            throw new BadRequestException('Funding reference must be a UUID');
          }
          const funding = await this.prisma.funding.findUnique({
            where: { reference },
          });
          this.logger.debug(`Funding lookup complete for webhook ${event.id}`);
          if (!funding) throw new NotFoundException('Funding not found');
          const { amount, currency } = payload.data;
          if (
            typeof amount !== 'string' ||
            !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(amount) ||
            typeof currency !== 'string'
          ) {
            throw new BadRequestException(
              'Webhook amount must be a decimal string and currency is required',
            );
          }
          if (
            !funding.amount.eq(new Prisma.Decimal(amount)) ||
            funding.currency !== currency
          ) {
            throw new ConflictException(
              'Webhook settlement does not match funding amount and currency',
            );
          }
          // Duplicate provider events with different IDs must never double-credit.
          if (funding.status !== FundingStatus.COMPLETED) {
            try {
              await this.fundingService.confirmFunding(reference);
              this.logger.debug(
                `Funding confirmation complete for webhook ${event.id}`,
              );
            } catch (error: unknown) {
              if (!(error instanceof ConflictException)) throw error;
              const current = await this.prisma.funding.findUnique({
                where: { reference },
              });
              if (current?.status !== FundingStatus.COMPLETED) throw error;
            }
          }
        }
        const processed = await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: new Date(), error: null },
        });
        this.logger.log(`Webhook processed: ${event.id}`);
        return processed;
      } catch (error: unknown) {
        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            error:
              error instanceof Error
                ? error.message
                : 'Webhook processing failed',
          },
        });
        this.logger.error(`Webhook processing failed: ${event.id}`);
        throw error;
      }
    } catch (error: unknown) {
      this.logger.error(
        `processEvent failed: ${error instanceof Error ? error.message : 'unknown'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
