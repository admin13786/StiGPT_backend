import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateQuickReplyDto {
  @ApiProperty({
    description: '关键词/标题（可选）',
    example: '问候语',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @ApiProperty({
    description: '回复内容',
    example: '您好，请问有什么可以帮助您的吗？',
  })
  @IsString()
  @MaxLength(500)
  content: string;

  @ApiProperty({
    description: '分类ID（从已有分类中选择）',
    example: 'uuid',
    required: false,
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    description: '排序（仅管理员可设置）',
    example: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
