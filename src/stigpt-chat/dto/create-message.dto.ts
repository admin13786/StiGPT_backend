import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const STIGPT_ROUTE_MODES = ['policy', 'project', 'aiRead'] as const;

export class CreateMessageDto {
  @IsString()
  @MaxLength(8000)
  content!: string;

  @IsOptional()
  @IsString()
  @IsIn(STIGPT_ROUTE_MODES)
  routeMode?: (typeof STIGPT_ROUTE_MODES)[number];

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  kbId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
