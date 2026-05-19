import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsArray, IsIn, Min, Max } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: '知识库名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '知识库描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '权限范围', enum: ['public', 'internal', 'department', 'private'] })
  @IsOptional()
  @IsIn(['public', 'internal', 'department', 'private'])
  aclScope?: string;

  @ApiPropertyOptional({ description: '可访问用户列表', type: [String] })
  @IsOptional()
  @IsArray()
  aclUsers?: string[];

  @ApiPropertyOptional({ description: 'Embedding 模型', default: 'text-embedding-v2' })
  @IsOptional()
  @IsString()
  embeddingModel?: string;

  @ApiPropertyOptional({ description: '文档块大小', default: 500 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(2000)
  chunkSize?: number;

  @ApiPropertyOptional({ description: '文档块重叠', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  chunkOverlap?: number;
}
