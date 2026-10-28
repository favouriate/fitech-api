import { ApiProperty } from '@nestjs/swagger';

export class FundingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  reference!: string;

  @ApiProperty({ format: 'uuid' })
  walletId!: string;

  @ApiProperty({ example: '5000.0000' })
  amount!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'] })
  status!: string;

  @ApiProperty({ example: 'SIMULATED' })
  provider!: string;

  @ApiProperty({ required: false, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  completedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class FundingStatusResponseDto extends FundingResponseDto {
  @ApiProperty({
    description:
      'Current wallet balance after applying this funding (if completed)',
    example: '5000.0000',
  })
  walletBalance!: string;
}
