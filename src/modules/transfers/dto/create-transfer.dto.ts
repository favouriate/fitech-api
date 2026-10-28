import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, IsUUID } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({
    example: 'd0e1f2a3-b4c5-6789-0abc-def123456789',
    description: 'The ID of the wallet to receive the funds',
  })
  @IsUUID()
  receiverWalletId!: string;

  @ApiProperty({
    type: String,
    example: '500.0000',
    description:
      'Amount in NGN as a decimal string; minimum 1, at most 4 decimal places.',
    pattern: '^(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,4})?$',
  })
  // Preserve the original type even when the global pipe enables implicit conversion.
  @Transform(({ obj }) => (obj as Record<string, unknown>).amount)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/)
  amount!: string;
}
