import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FundingService } from './funding.service.js';
import { FundingController } from './funding.controller.js';
import { SimulatedProviderService } from './providers/simulated-provider.service.js';
import { ReconciliationProcessor } from './reconciliation.processor.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [
    WalletsModule,
    LedgerModule,
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'funding-reconciliation' }),
  ],
  controllers: [FundingController],
  providers: [
    FundingService,
    SimulatedProviderService,
    ReconciliationProcessor,
    Logger,
  ],
  exports: [FundingService, BullModule],
})
export class FundingModule {}
