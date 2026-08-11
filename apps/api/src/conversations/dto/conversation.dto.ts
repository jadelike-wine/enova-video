import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({ example: '我的新对话' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}

export class UpdateConversationDto {
  @ApiProperty({ example: '重命名对话' })
  @IsString()
  @MaxLength(500)
  title!: string;
}

export class CreateMessageDto {
  @ApiProperty({ example: 'user' })
  @IsString()
  @MaxLength(20)
  role!: string;

  @ApiProperty({ example: '你好，生成一张图片' })
  @IsString()
  @MaxLength(100_000)
  content!: string;

  @ApiPropertyOptional({ example: 'agnes' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @ApiPropertyOptional({ example: 'model-x' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}

export class SaveMessagesDto {
  @ApiProperty({ type: [CreateMessageDto] })
  @IsArray()
  @IsDefined()
  messages!: CreateMessageDto[];
}