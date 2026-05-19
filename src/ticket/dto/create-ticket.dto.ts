import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ description: '游戏ID', example: 'game-123' })
  @IsString()
  @IsNotEmpty()
  gameId: string;

  @ApiProperty({
    description: '区服ID（可选）',
    example: 'server-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  serverId?: string;

  @ApiProperty({
    description: '区服名称（可选）',
    example: '一区',
    required: false,
  })
  @IsString()
  @IsOptional()
  serverName?: string;

  @ApiProperty({ description: '玩家ID或昵称', example: '玩家123' })
  @IsString()
  @IsNotEmpty()
  playerIdOrName: string;

  @ApiProperty({ description: '问题描述', example: '我的账号登录不了' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: '问题发生时间（可选）',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  occurredAt?: string;

  @ApiProperty({
    description: '充值订单号（可选）',
    example: 'ORDER123',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentOrderNo?: string;

  @ApiProperty({
    description: '问题类型IDs',
    example: ['issue-type-1', 'issue-type-2'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  issueTypeIds: string[];
}

export class TicketResponseDto {
  @ApiProperty({ description: '工单ID' })
  id: string;

  @ApiProperty({ description: '工单号' })
  ticketNo: string;

  @ApiProperty({ description: '工单访问令牌' })
  token: string;

  @ApiProperty({
    description: '是否有在线客服（仅直接转人工时返回）',
    required: false,
  })
  hasOnlineAgents?: boolean;

  @ApiProperty({
    description: '是否已创建会话（仅直接转人工时返回）',
    required: false,
  })
  sessionCreated?: boolean;

  @ApiProperty({
    description: '会话ID（仅直接转人工且已创建会话时返回）',
    required: false,
  })
  sessionId?: string;
}
