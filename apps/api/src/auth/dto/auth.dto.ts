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

  @ApiProperty({ required: false, description: '用户同意的登录条款 revision；启用条款时必填' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agreementRevision?: string;
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

  @ApiProperty({ required: false, description: '用户同意的登录条款 revision；启用条款时必填' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agreementRevision?: string;
}

/** P1-6: 修改密码请求体。 */
export class ChangePasswordDto {
  @ApiProperty({ description: '当前密码' })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  newPassword!: string;
}

/** P1.5: 忘记密码请求体。 */
export class ForgotPasswordDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsString()
  @IsEmail()
  email!: string;
}

/** P1.5: 重置密码请求体。 */
export class ResetPasswordDto {
  @ApiProperty({ description: '重置 token（从邮件获取）' })
  @IsString()
  token!: string;

  @ApiProperty({ description: '新密码' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

/** P1.5: 邮箱验证请求体。 */
export class VerifyEmailDto {
  @ApiProperty({ description: '邮箱验证 token' })
  @IsString()
  token!: string;
}
