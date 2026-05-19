import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsUrl,
} from 'class-validator';

export class CreateGameDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean = true;

  @IsString()
  @IsNotEmpty()
  difyApiKey: string;

  @IsUrl()
  @IsNotEmpty()
  difyBaseUrl: string;
}

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

  @IsUrl()
  @IsOptional()
  difyBaseUrl?: string;
}
