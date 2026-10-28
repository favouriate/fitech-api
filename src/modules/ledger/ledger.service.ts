import { Injectable, Logger, Optional } from '@nestjs/common';
import { Direction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Ledger entries are immutable (append-only); balances are derived, never stored.
 * recordEntry requires a transaction client by design so entries participate in
 * the caller's atomic operation. Amounts use Prisma.Decimal for precision.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly logger?: Logger,
  ) {}

  async recordEntry(
    tx: Prisma.TransactionClient,
    params: {
      walletId: string;
      amount: number | Prisma.Decimal;
      direction: Direction;
      reference: string;
      description?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    const amount = new Prisma.Decimal(params.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new Error('Ledger entry amount must be positive and finite');
    }
    if (!params.reference.trim()) {
      throw new Error('Ledger entry reference is required');
    }

    await tx.ledgerEntry.create({
      data: {
        walletId: params.walletId,
        amount,
        direction: params.direction,
        reference: params.reference,
        ...(params.description !== undefined
          ? { description: params.description }
          : {}),
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
    });
    this.logger?.debug('Ledger entry recorded in caller transaction');
  }

  async getBalance(walletId: string): Promise<Prisma.Decimal> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { walletId },
      _sum: { amount: true },
    });
    const credits =
      rows.find((row) => row.direction === Direction.CREDIT)?._sum.amount ?? 0;
    const debits =
      rows.find((row) => row.direction === Direction.DEBIT)?._sum.amount ?? 0;
    return new Prisma.Decimal(credits).minus(debits);
  }

  async getBalances(walletIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const balances = new Map<string, Prisma.Decimal>(
      walletIds.map((walletId) => [walletId, new Prisma.Decimal(0)]),
    );
    if (walletIds.length === 0) {
      return balances;
    }

    // Aggregate every requested wallet in one database query. Calling getBalance
    // in a loop would issue one query per wallet and create an N+1 query problem.
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['walletId', 'direction'],
      where: { walletId: { in: walletIds } },
      _sum: { amount: true },
    });
    for (const row of rows) {
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      const balance = balances.get(row.walletId) ?? new Prisma.Decimal(0);
      balances.set(
        row.walletId,
        row.direction === Direction.CREDIT
          ? balance.plus(amount)
          : balance.minus(amount),
      );
    }
    return balances;
  }
}
