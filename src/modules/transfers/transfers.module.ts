import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WalletsModule } from '../wallets/wallets.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [
    WalletsModule,
    LedgerModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [TransfersController],
  providers: [TransfersService, Logger],
})
export class TransfersModule {}
