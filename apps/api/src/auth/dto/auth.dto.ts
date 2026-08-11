import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ required: false, description: 'Cloudflare Turnstile 验证码 token（启用时必填）' })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiProperty({ required: false, description: 'Cloudflare Turnstile 验证码 token（启用时必填）' })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}