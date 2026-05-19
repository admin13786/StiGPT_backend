import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';

export class CreateQuickReplyGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  gameId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
