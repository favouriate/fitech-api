import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsObject } from 'class-validator';

export class WebhookPayloadDto {
  @ApiProperty({ example: 'evt_123456789' })
  @IsString()
  eventId!: string;

  @ApiProperty({ example: 'funding.completed' })
  @IsString()
  eventType!: string;

  @ApiProperty({
    description: 'The event data',
    example: { reference: 'uuid-funding-ref', amount: 5000 },
  })
  @IsObject()
  data!: Record<string, unknown>;
}
