import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

const SUPPORTED_CURRENCIES = ['NGN'] as const;

export class CreateWalletDto {
  @ApiProperty({
    example: 'NGN',
    description: 'ISO 4217 currency code (NGN only for now)',
    enum: SUPPORTED_CURRENCIES,
  })
  @IsString()
  @Length(3, 3)
  @IsIn(SUPPORTED_CURRENCIES, {
    message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency!: string;
}
