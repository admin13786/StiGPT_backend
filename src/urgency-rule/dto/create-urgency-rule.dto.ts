import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
  IsArray,
  ArrayMinSize,
} from 'class-validator';

export class UrgencyRuleConditionsDto {
  // 问题类型ID列表 - 必需字段，至少选择一个
  @IsArray()
  @ArrayMinSize(1, { message: '至少需要选择一个问题类型' })
  @IsString({ each: true })
  issueTypeIds: string[];

  // 以下字段为可选，用于更精确的匹配
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  intent?: string;

  @IsOptional()
  @IsString()
  identityStatus?: string;

  @IsOptional()
  @IsString()
  gameId?: string;

  @IsOptional()
  @IsString()
  serverId?: string;

  @IsOptional()
  @IsString()
  priority?: string;
}

export class CreateUrgencyRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean = true;

  @IsInt()
  @Min(1)
  @Max(100)
  priorityWeight: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsNotEmpty()
  conditions: UrgencyRuleConditionsDto;
}

export class UpdateUrgencyRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  priorityWeight?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  conditions?: UrgencyRuleConditionsDto;
}
