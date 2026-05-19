import {
  IsString,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export enum SortByEnum {
  USAGE_COUNT = 'usageCount',
  FAVORITE_COUNT = 'favoriteCount',
  LAST_USED_AT = 'lastUsedAt',
}

export class QueryReplyDto {
  @ApiProperty({
    example: 'category-1',
    description: '分类 ID',
    required: false,
  })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ example: false, description: '仅显示收藏', required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @Type(() => Boolean)
  @IsBoolean({ message: 'onlyFavorites must be a boolean value' })
  onlyFavorites?: boolean;

  @ApiProperty({
    example: false,
    description: '仅显示最近使用',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @Type(() => Boolean)
  @IsBoolean({ message: 'onlyRecent must be a boolean value' })
  onlyRecent?: boolean;

  @ApiProperty({
    example: true,
    description: '启用状态筛选：true=启用, false=未启用, null=全部',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    // 处理字符串形式的布尔值
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === null) return null;
    // 如果已经是布尔值，直接返回
    if (typeof value === 'boolean') return value;
    // undefined 或其他值，返回 undefined（保持向后兼容）
    return undefined;
  })
  isActive?: boolean | null;

  @ApiProperty({
    enum: SortByEnum,
    example: SortByEnum.USAGE_COUNT,
    description: '排序方式',
    required: false,
  })
  @IsEnum(SortByEnum, {
    message: '排序方式必须是 usageCount、favoriteCount 或 lastUsedAt',
  })
  @IsOptional()
  sortBy?: SortByEnum | string;

  @ApiProperty({ example: 1, description: '页码', required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ example: 20, description: '每页数量', required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;
}
