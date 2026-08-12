import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** 首启创建管理员请求体。 */
export class SetupInitDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, description: '管理员密码' })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;
}