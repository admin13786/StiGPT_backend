import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTicketStatusDto {
  @ApiProperty({
    description: '工单状态',
    enum: ['WAITING', 'IN_PROGRESS', 'RESOLVED'],
    example: 'RESOLVED',
  })
  @IsEnum(['WAITING', 'IN_PROGRESS', 'RESOLVED'], {
    message: '状态必须是 WAITING、IN_PROGRESS 或 RESOLVED 之一',
  })
  status: 'WAITING' | 'IN_PROGRESS' | 'RESOLVED';

  @ApiProperty({
    description: '关闭者ID（可选，用于记录谁关闭了工单）',
    example: 'player-123',
    required: false,
  })
  @IsOptional()
  @IsString()
  closedBy?: string;
}
