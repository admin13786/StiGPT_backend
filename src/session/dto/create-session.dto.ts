import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({ description: '工单ID', example: 'ticket-123' })
  @IsString()
  @IsNotEmpty()
  ticketId: string;
}

export class TransferToAgentDto {
  @ApiProperty({
    description: '紧急程度',
    enum: ['URGENT', 'NON_URGENT'],
    example: 'URGENT',
  })
  @IsString()
  @IsNotEmpty()
  urgency: 'URGENT' | 'NON_URGENT';

  @ApiProperty({
    required: false,
    description: '玩家转人工的原因或补充说明',
    example: '多次尝试无效，需要人工协助',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    required: false,
    description: '关联的问题类型 ID',
    example: 'issue-type-1',
  })
  @IsOptional()
  @IsString()
  issueTypeId?: string;
}
