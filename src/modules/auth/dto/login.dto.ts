import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({ example: 'Str0ng!Passw0rd', maxLength: 1024 })
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  @MaxLength(1024)
  password!: string;
}
