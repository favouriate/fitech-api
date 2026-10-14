import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max, Min } from 'class-validator';

export class InitiateFundingDto {
  @ApiProperty({
    example: 5000,
    description: 'Amount to fund in NGN. Must be between 1 and 10,000,000.',
    minimum: 1,
    maximum: 10000000,
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  @Min(1)
  @Max(10_000_000)
  amount!: number;
}
