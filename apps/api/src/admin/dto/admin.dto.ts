import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
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

export class UpdateSettingDto {
  @ApiProperty({ example: '100', description: '字符串形式的新值' })
  @IsString()
  @MaxLength(4000)
  value!: string;

  @ApiPropertyOptional({ description: 'CAS 乐观并发版本号（可选）' })
  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}

export class BatchSettingItemDto {
  @ApiProperty({ example: 'payment.alipayAppId' })
  @IsString()
  key!: string;

  @ApiProperty({ example: '2021000...', description: '字符串形式的新值；Secret 留空=保持不变' })
  @IsString()
  @MaxLength(4000)
  value!: string;
}

export class BatchUpdateSettingsDto {
  @ApiProperty({ type: [BatchSettingItemDto], description: '批量更新项（同组配置原子更新）' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchSettingItemDto)
  items!: BatchSettingItemDto[];
}

// ---- P0-8: 商业控制台 DTO ----

export class OrderListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ['RECHARGE', 'PLAN', 'CREDIT_PACK'] })
  @IsOptional()
  @IsString()
  orderType?: string;
}

export class GenerationListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '按 workspace 过滤' })
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

export class ForceFailJobDto {
  @ApiProperty({ example: 'worker 挂死，手动救援' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class CreatePricingRuleDto {
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'AUDIO', 'UPSCALE', 'LIPSYNC', 'IMAGE_TO_VIDEO', 'VIDEO_TO_VIDEO'] })
  @IsString()
  generationType!: string;

  @ApiProperty({ example: 'agnes' })
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ example: 'kling-v2' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(0)
  credits!: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  pricingJson?: Record<string, unknown>;
}

export class UpdatePricingRuleDto {
  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  credits?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  pricingJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  enabled?: boolean;
}

export class PublishPricingVersionDto {
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'AUDIO', 'UPSCALE', 'LIPSYNC', 'IMAGE_TO_VIDEO', 'VIDEO_TO_VIDEO'] })
  @IsString()
  generationType!: string;

  @ApiProperty({ example: 'agnes' })
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ example: 'kling-v2' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  credits!: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  pricingJson?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  dimensionsJson?: Record<string, unknown>;
}

export class PricingVersionListQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  generationType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsString()
  status?: string;
}

export class PreviewQuoteDto {
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'AUDIO', 'UPSCALE', 'LIPSYNC', 'IMAGE_TO_VIDEO', 'VIDEO_TO_VIDEO'] })
  @IsString()
  type!: string;

  @ApiProperty({ example: 'agnes' })
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ example: 'kling-v2' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  dimensions?: Record<string, unknown>;
}