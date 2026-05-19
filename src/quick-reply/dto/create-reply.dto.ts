import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReplyDto {
  @ApiProperty({ example: 'category-1', description: '分类 ID' })
  @IsString()
  @IsNotEmpty({ message: '分类 ID 不能为空' })
  categoryId: string;

  @ApiProperty({
    example: '感谢您的咨询，我们已收到您的问题...',
    description: '快捷回复内容',
  })
  @IsString()
  @IsNotEmpty({ message: '快捷回复内容不能为空' })
  @MinLength(1)
  @MaxLength(300, { message: '快捷回复长度不能超过 300 字' })
  @Matches(/^[\s\S]*\S[\s\S]*$/, {
    message: '快捷回复不能全是空白字符',
  })
  content: string;

  @ApiProperty({
    example: false,
    description: '是否为全局模板',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;

  @ApiProperty({ example: 0, description: '排序', required: false })
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
