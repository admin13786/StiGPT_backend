import { IsString, IsBoolean, IsOptional } from 'class-validator';

export class UpdateGameDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  difyApiKey?: string;

  @IsString()
  @IsOptional()
  difyBaseUrl?: string;
}
