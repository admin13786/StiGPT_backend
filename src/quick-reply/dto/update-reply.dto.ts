import { PartialType } from '@nestjs/mapped-types';
import { CreateReplyDto } from './create-reply.dto';
import { IsBoolean, IsOptional, IsString, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateReplyDto extends PartialType(CreateReplyDto) {
  @ApiProperty({
    example: 'category-1',
    description: '分类 ID',
    required: false,
  })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({
    example: '感谢您的咨询，我们已收到您的问题...',
    description: '快捷回复内容',
    required: false,
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({ example: 0, description: '排序', required: false })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ example: true, description: '是否启用', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
