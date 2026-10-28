import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class InitiateFundingDto {
  @ApiProperty({
    type: String,
    example: '500.0000',
    description: 'Amount in NGN as a decimal string; between 1 and 10,000,000.',
    pattern: '^(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,4})?$',
  })
  // Preserve the original type even when the global pipe enables implicit conversion.
  @Transform(({ obj }) => (obj as Record<string, unknown>).amount)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/)
  amount!: string;
}
