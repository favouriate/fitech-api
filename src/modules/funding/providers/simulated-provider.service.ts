import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ProviderInitiationResult {
  providerRef: string;
  status: 'PENDING' | 'FAILED';
}

/**
 * SimulatedProviderService — a fake payment provider for local development
 * and testing. In production, this would be replaced by an adapter for
 * Paystack, Flutterwave, or another PSP.
 *
 * Interface contract (any real provider adapter must match):
 *   initiate(reference, amount, currency) → ProviderInitiationResult
 */
@Injectable()
export class SimulatedProviderService {
  constructor(private readonly logger: Logger) {}

  async initiate(
    reference: string,
    amount: number,
    currency: string,
  ): Promise<ProviderInitiationResult> {
    const providerRef = `SIM-${randomUUID()}`;
    this.logger.log(
      `[SIMULATED] Provider accepted funding ${reference} for ${amount} ${currency} (providerRef=${providerRef})`,
    );
    return { providerRef, status: 'PENDING' };
  }
}
