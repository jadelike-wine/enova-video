import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ASSET_TYPES } from '@enova/contracts';

export const ASSET_LIST_TYPES = {
  ALL: 'ALL',
  IMAGE: ASSET_TYPES.IMAGE,
  VIDEO: ASSET_TYPES.VIDEO,
} as const;

export type AssetListType = (typeof ASSET_LIST_TYPES)[keyof typeof ASSET_LIST_TYPES];

export const ASSET_SORTS = {
  NEWEST: 'NEWEST',
  OLDEST: 'OLDEST',
} as const;

export type AssetSort = (typeof ASSET_SORTS)[keyof typeof ASSET_SORTS];

export class ListAssetsDto {
  @ApiPropertyOptional({ enum: ASSET_LIST_TYPES, default: ASSET_LIST_TYPES.ALL })
  @IsOptional()
  @IsEnum(ASSET_LIST_TYPES)
  type: AssetListType = ASSET_LIST_TYPES.ALL;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: ASSET_SORTS, default: ASSET_SORTS.NEWEST })
  @IsOptional()
  @IsEnum(ASSET_SORTS)
  sort: AssetSort = ASSET_SORTS.NEWEST;

  @ApiPropertyOptional({ default: 60, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 60;
}
