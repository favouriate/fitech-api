import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Direction, FundingStatus, Prisma, WalletStatus } from '@prisma/client';
import type { Funding, Wallet } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { SimulatedProviderService } from './providers/simulated-provider.service.js';
import { BusinessMetricsService } from '../metrics/business-metrics.service.js';

export type FundingNotification = {
  reference: string;
  walletId: string;
  amount: string;
  completedAt: Date | null;
};

async function serializable<T>(
  prisma: PrismaService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (
        attempt >= 2 ||
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'P2034'
      )
        throw error;
    }
  }
}

/**
 * FundingService — orchestrates the deposit lifecycle. Implements a strict
 * state machine (PENDING → COMPLETED/FAILED/EXPIRED), server-generated references
 * for reconciliation, pessimistic locking on wallet credits, and event
 * publishing via BullMQ. Every credit to a wallet goes through the ledger —
 * no balance is ever stored directly.
 */
@Injectable()
export class FundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly walletsService: WalletsService,
    private readonly simulatedProvider: SimulatedProviderService,
    private readonly logger: Logger,
    @InjectQueue('notifications')
    private readonly notificationsQueue: Queue<FundingNotification>,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  async initiate(userId: string, amount: string): Promise<Funding> {
    if (
      typeof amount !== 'string' ||
      !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(amount)
    ) {
      throw new BadRequestException(
        'Amount must be between 1 and 10,000,000 NGN with at most 4 decimal places',
      );
    }
    const decimalAmount = new Prisma.Decimal(amount);
    if (decimalAmount.lt(1) || decimalAmount.gt('10000000'))
      throw new BadRequestException(
        'Amount must be between 1 and 10,000,000 NGN with at most 4 decimal places',
      );
    const wallet = await this.walletsService.findByUser(userId);
    if (!wallet) {
      throw new NotFoundException('No wallet found. Create a wallet first.');
    }
    if (wallet.currency !== 'NGN' || wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException('An active NGN wallet is required');
    }
    const reference = randomUUID();
    await this.prisma.funding.create({
      data: {
        reference,
        walletId: wallet.id,
        amount: decimalAmount,
        currency: 'NGN',
        provider: 'SIMULATED',
        status: FundingStatus.PENDING,
      },
    });
    const result = await this.simulatedProvider.initiate(
      reference,
      decimalAmount.toFixed(4),
      'NGN',
    );
    const funding = await this.prisma.funding.update({
      where: { reference },
      data: { providerRef: result.providerRef },
    });
    if (result.status === 'FAILED') {
      return this.failFunding(
        reference,
        'Provider rejected funding initiation',
      );
    }
    this.logger.log(
      `Funding initiated: ${reference} for user ${userId}, amount ${amount}`,
    );
    this.metrics?.recordFundingInitiated();
    return funding;
  }

  async findByReference(
    reference: string,
    userId: string,
  ): Promise<{ funding: Funding; walletBalance: Prisma.Decimal }> {
    const funding = await this.prisma.funding.findUnique({
      where: { reference },
    });
    if (!funding) throw new NotFoundException('Funding not found');
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: funding.walletId },
    });
    if (!wallet || wallet.userId !== userId)
      throw new NotFoundException('Funding not found');
    const walletBalance = await this.ledger.getBalance(funding.walletId);
    return { funding, walletBalance };
  }

  async confirmFunding(reference: string): Promise<Funding> {
    const funding = await serializable(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<Funding[]>`
        SELECT * FROM "fundings" WHERE "reference" = ${reference} FOR UPDATE
      `;
      const pending = rows[0];
      if (!pending) throw new NotFoundException('Funding not found');
      if (pending.status !== FundingStatus.PENDING) {
        throw new ConflictException(
          `Cannot confirm funding in status ${pending.status}`,
        );
      }
      const wallets = await tx.$queryRaw<Wallet[]>`
        SELECT * FROM "wallets" WHERE "id" = ${pending.walletId} FOR UPDATE
      `;
      const wallet = wallets[0];
      if (!wallet) throw new NotFoundException('Wallet not found');
      if (
        wallet.status !== WalletStatus.ACTIVE ||
        wallet.currency !== pending.currency ||
        pending.currency !== 'NGN'
      ) {
        throw new BadRequestException('An active NGN wallet is required');
      }
      await this.ledger.recordEntry(tx, {
        walletId: pending.walletId,
        amount: pending.amount,
        direction: Direction.CREDIT,
        reference: `FUND-${reference}`,
        description: 'Funding deposit',
      });
      return tx.funding.update({
        where: { id: pending.id },
        data: { status: FundingStatus.COMPLETED, completedAt: new Date() },
      });
    });
    this.logger.log(`Funding completed: ${reference}`);
    this.metrics?.recordFundingCompleted();
    try {
      await this.notificationsQueue.add('funding-completed', {
        reference: funding.reference,
        walletId: funding.walletId,
        amount: funding.amount.toFixed(4),
        completedAt: funding.completedAt,
      });
    } catch {
      // The credit already committed; a queue outage cannot undo it.
      this.logger.error(
        `Funding committed but notification enqueue failed: ${reference}`,
      );
    }
    return funding;
  }

  async failFunding(reference: string, reason: string): Promise<Funding> {
    // Lock the same row as confirmation to prevent overwriting COMPLETED.
    return serializable(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<Funding[]>`
        SELECT * FROM "fundings" WHERE "reference" = ${reference} FOR UPDATE
      `;
      const funding = rows[0];
      if (!funding) throw new NotFoundException('Funding not found');
      if (funding.status !== FundingStatus.PENDING) {
        throw new ConflictException(
          `Cannot fail funding in status ${funding.status}`,
        );
      }
      return tx.funding.update({
        where: { id: funding.id },
        data: { status: FundingStatus.FAILED, failureReason: reason },
      });
    });
  }

  async expireStaleFundings(maxAgeMinutes: number): Promise<number> {
    if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
      throw new BadRequestException(
        'Maximum funding age must be positive and finite',
      );
    }
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const result = await this.prisma.funding.updateMany({
      where: { status: FundingStatus.PENDING, createdAt: { lt: cutoff } },
      data: {
        status: FundingStatus.EXPIRED,
        failureReason: 'Expired: no confirmation received within window',
      },
    });
    this.logger.log(`Expired ${result.count} stale fundings`);
    return result.count;
  }
}
