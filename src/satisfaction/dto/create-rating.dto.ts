import {
  IsInt,
  IsNotEmpty,
  Min,
  Max,
  IsArray,
  IsString,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRatingDto {
  @ApiProperty({ description: '会话ID', example: 'session-123' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({
    description: '评分（1-5）',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    description: '标签',
    example: ['服务态度好', '响应及时'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  tags: string[];

  @ApiProperty({
    description: '评论（可选）',
    example: '服务很好',
    required: false,
  })
  @IsString()
  @IsOptional()
  comment?: string;
}
