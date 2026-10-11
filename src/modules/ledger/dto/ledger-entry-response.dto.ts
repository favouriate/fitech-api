import { ApiProperty } from '@nestjs/swagger';

export class LedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  walletId!: string;

  @ApiProperty({
    example: '1500.0000',
    description: 'Amount as a decimal string (preserves precision)',
  })
  amount!: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  direction!: 'DEBIT' | 'CREDIT';

  @ApiProperty({ description: 'Reference linking related entries' })
  reference!: string;

  @ApiProperty({ required: false, nullable: true })
  description!: string | null;

  @ApiProperty({ required: false, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
