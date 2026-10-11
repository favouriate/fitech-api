import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { LedgerEntry, Wallet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

export type WalletWithBalance = Wallet & { balance: number };

export type PaginatedLedgerResult = {
  data: LedgerEntry[];
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
};

/**
 * WalletsService — manages user wallets. Balances are NOT stored; they are
 * derived on demand from the ledger via LedgerService. Resource-level
 * authorization is enforced in findOneForUser by returning 404 (not 403) on
 * cross-user access — this prevents wallet ID enumeration.
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Optional() private readonly logger?: Logger,
  ) {}

  async create(userId: string, currency: string): Promise<Wallet> {
    currency = currency.toUpperCase();
    try {
      const wallet = await this.prisma.wallet.create({
        data: { userId, currency },
      });
      this.logger?.log(`Wallet created: ${wallet.id}`);
      return wallet;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You already have a wallet');
      }
      throw error;
    }
  }

  async findByUser(userId: string): Promise<WalletWithBalance | null> {
    const wallet = await this.prisma.wallet.findFirst({ where: { userId } });
    if (!wallet) {
      return null;
    }
    const balance = await this.ledger.getBalance(wallet.id);
    return { ...wallet, balance };
  }

  async findOneForUser(
    walletId: string,
    userId: string,
  ): Promise<WalletWithBalance> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }
    const balance = await this.ledger.getBalance(wallet.id);
    return { ...wallet, balance };
  }

  /** For internal use only — does NOT check ownership. */
  async findByIdUnsafe(walletId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { id: walletId } });
  }

  async getLedgerEntries(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PaginatedLedgerResult> {
    // Fetch one extra entry in the same query to detect another page.
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasNextPage = entries.length > limit;
    const data = hasNextPage ? entries.slice(0, limit) : entries;
    const nextCursor = hasNextPage ? (data.at(-1)?.id ?? null) : null;
    return {
      data,
      pagination: { nextCursor, hasNextPage, limit },
    };
  }
}
