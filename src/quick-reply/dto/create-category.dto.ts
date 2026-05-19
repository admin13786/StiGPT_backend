import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsInt,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: '常见问题', description: '分类名称' })
  @IsString()
  @IsNotEmpty({ message: '分类名称不能为空' })
  name: string;

  @ApiProperty({
    example: false,
    description: '是否为全局分类',
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
