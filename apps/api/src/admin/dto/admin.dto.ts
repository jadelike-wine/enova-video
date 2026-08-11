import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import {
  CREDENTIAL_STATUSES,
  PROVIDER_STATUSES,
  USER_STATUSES,
  type CredentialStatus,
  type ProviderStatus,
  type UserStatus,
} from '@enova/contracts';

export class ListQueryDto {
  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateProviderDto {
  @ApiProperty({ example: 'agnes' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Agnes AI' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'https://api.agnes.example.com' })
  @IsString()
  @MaxLength(500)
  baseUrl!: string;

  @ApiPropertyOptional({ enum: PROVIDER_STATUSES })
  @IsOptional()
  @IsEnum(PROVIDER_STATUSES)
  status?: ProviderStatus;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateProviderDto {
  @ApiPropertyOptional({ example: 'Agnes AI' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'https://api.agnes.example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({ enum: PROVIDER_STATUSES })
  @IsOptional()
  @IsEnum(PROVIDER_STATUSES)
  status?: ProviderStatus;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateCredentialDto {
  @ApiProperty({ example: 'sk-xxxx' })
  @IsString()
  @MaxLength(2000)
  secret!: string;

  @ApiPropertyOptional({ enum: CREDENTIAL_STATUSES })
  @IsOptional()
  @IsEnum(CREDENTIAL_STATUSES)
  status?: CredentialStatus;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  weight?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrency?: number;
}

export class UpdateCredentialDto {
  @ApiPropertyOptional({ example: 'sk-xxxx' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  secret?: string;

  @ApiPropertyOptional({ enum: CREDENTIAL_STATUSES })
  @IsOptional()
  @IsEnum(CREDENTIAL_STATUSES)
  status?: CredentialStatus;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  weight?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrency?: number;

  @ApiPropertyOptional({ example: true, description: '清除 cooldown/lastError，手动恢复' })
  @IsOptional()
  clearBackoff?: boolean;
}

export class SetUserStatusDto {
  @ApiProperty({ enum: USER_STATUSES })
  @IsEnum(USER_STATUSES)
  status!: UserStatus;
}

export class AdjustCreditsDto {
  @ApiProperty({ example: 1000, description: '正数增加，负数扣减' })
  @IsInt()
  delta!: number;

  @ApiPropertyOptional({ example: '补偿用户' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}