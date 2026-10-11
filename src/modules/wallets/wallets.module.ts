import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  imports: [LedgerModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
