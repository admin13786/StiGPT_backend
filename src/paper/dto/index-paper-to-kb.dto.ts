import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class IndexPaperToKbDto {
  @IsString()
  kbId: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  reprocess?: boolean;
}
