import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';

// 重新导出 MessageType 供其他模块使用
export { MessageType };

export class CreateMessageDto {
  @ApiProperty({ description: '会话ID', example: 'session-123' })
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ description: '消息内容', example: '你好,我需要帮助' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: '消息类型',
    enum: MessageType,
    example: MessageType.TEXT,
    default: MessageType.TEXT,
  })
  @IsEnum(MessageType)
  messageType: MessageType = MessageType.TEXT;

  @ApiProperty({
    description: '消息元数据',
    required: false,
  })
  @IsOptional()
  metadata?: any;
}
