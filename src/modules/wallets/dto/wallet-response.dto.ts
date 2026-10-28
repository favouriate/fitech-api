import { ApiProperty } from '@nestjs/swagger';

export class WalletResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({ enum: ['ACTIVE', 'FROZEN', 'CLOSED'] })
  status!: string;

  @ApiProperty({
    example: '15000.5000',
    description: 'Balance in NGN, derived from ledger entries',
  })
  balance!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
