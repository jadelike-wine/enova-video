import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { GENERATION_TYPES, type GenerationType } from '@enova/contracts';

export class CreateGenerationDto {
  @ApiProperty({ enum: GENERATION_TYPES, example: 'IMAGE' })
  @IsEnum(GENERATION_TYPES)
  type!: GenerationType;

  @ApiProperty({ example: 'agnes' })
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ example: 'model-image-1' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}