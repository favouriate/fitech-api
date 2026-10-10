import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsStrongPassword,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'ada@example.com',
    description: 'User email (unique across the platform)',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'Str0ng!Passw0rd',
    description:
      'Password — 8+ chars, must include uppercase, lowercase, number, and symbol',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  @IsStrongPassword(
    {
      minLength: 8,
      minUppercase: 1,
      minLowercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password must include uppercase, lowercase, number, and special character',
    },
  )
  password!: string;

  @ApiProperty({ example: 'Ada', description: 'First name' })
  @IsString()
  @Matches(/\S/, { message: 'First name cannot be blank' })
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Okafor', description: 'Last name' })
  @IsString()
  @Matches(/\S/, { message: 'Last name cannot be blank' })
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;
}
