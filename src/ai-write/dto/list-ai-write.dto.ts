import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAiWriteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNo?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @IsOptional()
  @IsString()
  searchKey?: string;

  @IsOptional()
  @IsIn(['all', 'project', 'paper'])
  type?: 'all' | 'project' | 'paper' = 'all';

  @IsOptional()
  @IsIn(['all', '7d', '30d', '180d', '365d', 'older'])
  writingTime?: 'all' | '7d' | '30d' | '180d' | '365d' | 'older' = 'all';
}
