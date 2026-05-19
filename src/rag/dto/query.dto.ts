import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryDto {
  @ApiProperty({ description: '用户问题', example: '什么是深度学习？' })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiProperty({ description: '知识库ID' })
  @IsString()
  @IsNotEmpty()
  kbId: string;

  @ApiPropertyOptional({ description: '会话ID（用于上下文）' })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({ description: '检索数量', default: 5, minimum: 1, maximum: 20 })
  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  topK?: number;

  @ApiPropertyOptional({ description: 'LLM 温度', default: 0.7, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  temperature?: number;

  @ApiPropertyOptional({ description: '是否流式返回', default: false })
  @IsOptional()
  stream?: boolean;
}

export class QueryResponseDto {
  @ApiProperty({ description: '生成的答案' })
  answer: string;

  @ApiProperty({ description: '引用的文档块' })
  citations: CitationDto[];

  @ApiProperty({ description: '检索到的相关块数量' })
  retrievedCount: number;

  @ApiProperty({ description: '使用的 token 数量' })
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };

  @ApiProperty({ description: '处理时间（毫秒）' })
  processingTime: number;
}

export class CitationDto {
  @ApiProperty({ description: '文档块ID' })
  chunkId: string;

  @ApiProperty({ description: '文档ID' })
  documentId: string;

  @ApiProperty({ description: '文档标题' })
  documentTitle: string;

  @ApiProperty({ description: '文本内容' })
  content: string;

  @ApiProperty({ description: '相似度分数' })
  score: number;

  @ApiProperty({ description: '块索引' })
  chunkIndex: number;
}
