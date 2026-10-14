import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID, Min } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({
    example: 'd0e1f2a3-b4c5-6789-0abc-def123456789',
    description: 'The ID of the wallet to receive the funds',
  })
  @IsUUID()
  receiverWalletId!: string;

  @ApiProperty({
    example: 500,
    description: 'Amount in NGN (e.g., 500 = ₦500). Must be positive.',
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount!: number;
}
