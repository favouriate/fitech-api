import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Access token TTL in seconds' })
  expiresIn!: number;
}

export class AuthResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ type: AuthTokensDto })
  tokens!: AuthTokensDto;
}

export class MessageResponseDto {
  @ApiProperty() message!: string;
}
