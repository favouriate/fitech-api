import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Direction,
  IdempotencyStatus,
  Prisma,
  TransferStatus,
  WalletStatus,
} from '@prisma/client';
import type { IdempotencyKey, Transfer, Wallet } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { BusinessMetricsService } from '../metrics/business-metrics.service.js';

export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
};

export type TransferNotification = {
  transferId: string;
  senderWalletId: string;
  receiverWalletId: string;
  amount: string;
  currency: string;
  reference: string;
};

const storedTransferSchema = z.object({
  id: z.string(),
  senderWalletId: z.string(),
  receiverWalletId: z.string(),
  amount: z.string(),
  currency: z.string(),
  status: z.enum(TransferStatus),
  reference: z.string(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

function replayTransfer(
  key: IdempotencyKey,
  userId: string,
  requestHash: string,
): Transfer {
  if (key.userId !== userId || key.requestHash !== requestHash) {
    throw new ConflictException('Idempotency key is bound to another request');
  }
  if (key.status === IdempotencyStatus.STARTED) {
    throw new ConflictException(
      'Request with this idempotency key is already in progress',
    );
  }
  const stored = storedTransferSchema.parse(key.responseBody);
  return {
    ...stored,
    amount: new Prisma.Decimal(stored.amount),
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  };
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

/**
 * TransfersService — orchestrates the entire money movement lifecycle. This
 * service is the heart of the system. It implements idempotency, ACID
 * transactions with pessimistic locking, and event-driven notifications.
 * Every transfer is guaranteed to be processed exactly once for a retained
 * idempotency key. Notification delivery is a separate post-commit operation.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly walletsService: WalletsService,
    private readonly logger: Logger,
    @InjectQueue('notifications')
    private readonly notifications: Queue<TransferNotification>,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  async executeTransfer(
    senderId: string,
    dto: CreateTransferDto,
    idempotencyKey: string,
  ): Promise<Transfer> {
    try {
      if (!idempotencyKey?.trim()) {
        throw new BadRequestException('Idempotency-Key header is required');
      }
      if (
        !Number.isFinite(dto.amount) ||
        dto.amount < 1 ||
        dto.amount > Number.MAX_SAFE_INTEGER ||
        new Prisma.Decimal(dto.amount).decimalPlaces() > 4
      ) {
        throw new BadRequestException(
          'Amount must be at least 1 NGN, within the safe numeric range, and have at most 4 decimal places',
        );
      }
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            receiverWalletId: dto.receiverWalletId,
            amount: dto.amount,
          }),
        )
        .digest('hex');
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      if (existing) {
        const transfer = replayTransfer(existing, senderId, requestHash);
        this.logger.log(`Reusing completed transfer: ${transfer.id}`);
        return transfer;
      }

      const sender = await this.prisma.wallet.findFirst({
        where: { userId: senderId, currency: 'NGN' },
      });
      if (!sender) {
        throw new NotFoundException('Wallet not found');
      }

      let reservation: IdempotencyKey;
      try {
        reservation = await this.prisma.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            userId: senderId,
            requestHash,
            status: IdempotencyStatus.STARTED,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } catch (error: unknown) {
        if (!hasPrismaCode(error, 'P2002')) throw error;
        const winner = await this.prisma.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });
        if (!winner) throw error;
        const transfer = replayTransfer(winner, senderId, requestHash);
        this.logger.log(`Reusing completed transfer: ${transfer.id}`);
        return transfer;
      }

      // DTO, ledger entries, and wallet balances all use NGN directly.
      const amount = new Prisma.Decimal(dto.amount);
      const reference = `TRF-${randomUUID()}`;
      let transfer: Transfer | undefined;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            transfer = await this.prisma.$transaction(
              async (tx) => {
                // Each transfer locks in the same order, including reverse transfers.
                const walletIds = [
                  ...new Set([sender.id, dto.receiverWalletId]),
                ].sort();
                const locked = new Map<string, Wallet>();
                for (const id of walletIds) {
                  const rows = await tx.$queryRaw<Wallet[]>`
                SELECT * FROM "wallets" WHERE "id" = ${id} FOR UPDATE
              `;
                  if (rows[0]) locked.set(id, rows[0]);
                }
                await this.walletsService.findOneForUser(sender.id, senderId);
                const senderWallet = locked.get(sender.id);
                const receiverWallet = locked.get(dto.receiverWalletId);
                if (
                  !senderWallet ||
                  senderWallet.userId !== senderId ||
                  !receiverWallet
                ) {
                  throw new NotFoundException('Wallet not found');
                }
                if (senderWallet.id === receiverWallet.id) {
                  throw new BadRequestException(
                    'Cannot transfer to the same wallet',
                  );
                }
                if (
                  senderWallet.status !== WalletStatus.ACTIVE ||
                  receiverWallet.status !== WalletStatus.ACTIVE
                ) {
                  throw new BadRequestException('Both wallets must be active');
                }
                if (
                  senderWallet.currency !== 'NGN' ||
                  receiverWallet.currency !== 'NGN'
                ) {
                  throw new BadRequestException('Both wallets must use NGN');
                }
                // Do not use the service's external balance read for authorization:
                // this aggregation must share the transaction's serializable snapshot.
                const totals = await tx.ledgerEntry.groupBy({
                  by: ['direction'],
                  where: { walletId: sender.id },
                  _sum: { amount: true },
                });
                let balance = new Prisma.Decimal(0);
                for (const row of totals) {
                  const total = row._sum.amount ?? new Prisma.Decimal(0);
                  balance =
                    row.direction === Direction.CREDIT
                      ? balance.plus(total)
                      : balance.minus(total);
                }
                if (balance.lt(amount)) {
                  throw new BadRequestException('Insufficient balance');
                }
                await this.ledgerService.recordEntry(tx, {
                  walletId: sender.id,
                  amount,
                  direction: Direction.DEBIT,
                  reference,
                });
                await this.ledgerService.recordEntry(tx, {
                  walletId: receiverWallet.id,
                  amount,
                  direction: Direction.CREDIT,
                  reference,
                });
                const created = await tx.transfer.create({
                  data: {
                    senderWalletId: sender.id,
                    receiverWalletId: receiverWallet.id,
                    amount,
                    currency: 'NGN',
                    status: TransferStatus.COMPLETED,
                    reference,
                  },
                });
                await tx.idempotencyKey.update({
                  where: { id: reservation.id },
                  data: {
                    status: IdempotencyStatus.FINISHED,
                    responseBody: {
                      ...created,
                      amount: created.amount.toString(),
                      createdAt: created.createdAt.toISOString(),
                      updatedAt: created.updatedAt.toISOString(),
                    },
                  },
                });
                return created;
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
            break;
          } catch (error: unknown) {
            if (!hasPrismaCode(error, 'P2034') || attempt === 2) throw error;
            this.logger.warn(
              'Retrying serialized transfer after a write conflict',
            );
          }
        }
        if (!transfer) throw new Error('Transfer transaction did not complete');
      } catch (error: unknown) {
        // A rolled-back request must be retryable. Never delete a committed key.
        try {
          await this.prisma.idempotencyKey.deleteMany({
            where: { id: reservation.id, status: IdempotencyStatus.STARTED },
          });
        } catch {
          this.logger.error(
            `Failed to release transfer reservation: ${reservation.id}`,
          );
        }
        throw error;
      }

      this.logger.log(`Transfer completed: ${transfer.id}`);
      this.metrics?.recordTransfer('success');
      try {
        await this.notifications.add(
          'transfer-completed',
          {
            transferId: transfer.id,
            senderWalletId: transfer.senderWalletId,
            receiverWalletId: transfer.receiverWalletId,
            amount: transfer.amount.toString(),
            currency: transfer.currency,
            reference: transfer.reference,
          },
          {
            jobId: transfer.id,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
      } catch {
        // The money has committed; a queue failure must not report transfer failure.
        this.logger.error(
          `Transfer committed but notification enqueue failed: ${transfer.id}`,
        );
      }
      return transfer;
    } catch (error: unknown) {
      this.metrics?.recordTransfer('failed');
      throw error;
    }
  }

  async findAllForUser(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResult<Transfer>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException(
        'Limit must be an integer between 1 and 100',
      );
    }
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const where: Prisma.TransferWhereInput = {
      OR: [
        { senderWalletId: { in: walletIds } },
        { receiverWalletId: { in: walletIds } },
      ],
    };
    if (
      cursor &&
      !(await this.prisma.transfer.findFirst({
        where: { ...where, id: cursor },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Transfer cursor not found');
    }
    const rows = await this.prisma.transfer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      data,
      pagination: {
        nextCursor: hasNextPage ? (data.at(-1)?.id ?? null) : null,
        hasNextPage,
        limit,
      },
    };
  }

  async findOneForUser(transferId: string, userId: string): Promise<Transfer> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      select: { id: true },
    });
    const walletIds = wallets.map((wallet) => wallet.id);
    const transfer = await this.prisma.transfer.findFirst({
      where: {
        id: transferId,
        OR: [
          { senderWalletId: { in: walletIds } },
          { receiverWalletId: { in: walletIds } },
        ],
      },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }
}
