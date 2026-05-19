import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class IdentityCheckDto {
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @IsString()
  @IsOptional()
  serverId?: string;

  @IsString()
  @IsOptional()
  serverName?: string;

  @IsString()
  @IsNotEmpty()
  playerIdOrName: string;
}
