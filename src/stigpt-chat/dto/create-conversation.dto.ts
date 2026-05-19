import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const STIGPT_ROUTE_MODES = ['policy', 'project', 'aiRead'] as const;

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  routeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @IsIn(STIGPT_ROUTE_MODES)
  routeMode?: (typeof STIGPT_ROUTE_MODES)[number];

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  personaId?: string;

  @IsOptional()
  @IsString()
  kbId?: string;
}
