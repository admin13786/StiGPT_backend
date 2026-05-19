import { IsString, IsInt, IsOptional } from 'class-validator';

export class CreateQuickReplyItemDto {
  @IsString()
  content: string;

  @IsInt()
  groupId: number;

  @IsOptional()
  @IsString()
  shortcut?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
