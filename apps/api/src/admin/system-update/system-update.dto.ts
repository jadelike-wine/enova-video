import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SEMVER = /^\d+\.\d+\.\d+(\.\d+)?$/;

export class UpdateVersionDto {
  @ApiPropertyOptional({ example: '1.2.1', description: '目标版本（缺省为最新 stable）' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(SEMVER, { message: 'version must be a valid semver like 1.2.0' })
  version?: string;
}

export class RollbackVersionDto {
  @ApiPropertyOptional({ example: '1.1.2', description: '回退到指定版本；缺省回退到上一个版本' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(SEMVER, { message: 'version must be a valid semver like 1.1.2' })
  version?: string;
}