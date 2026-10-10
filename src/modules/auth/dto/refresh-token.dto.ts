import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The opaque refresh token issued at login',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  refreshToken!: string;
}
