import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class CreateServerDto {
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean = true;
}

export class UpdateServerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
