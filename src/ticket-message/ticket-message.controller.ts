import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { TicketMessageService } from './ticket-message.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('ticket-messages')
@ApiBearerAuth('JWT-auth')
@Controller('ticket-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT')
export class TicketMessageController {
  constructor(private readonly ticketMessageService: TicketMessageService) {}

  // 回复工单
  @Post(':ticketId/reply')
  @ApiOperation({ summary: '回复工单' })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
      },
      required: ['content'],
    },
  })
  @ApiResponse({ status: 201, description: '回复成功' })
  create(
    @Param('ticketId') ticketId: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    return this.ticketMessageService.create(ticketId, user.id, body.content);
  }

  // 获取工单消息列表
  @Get(':ticketId')
  @ApiOperation({ summary: '获取工单消息列表' })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiResponse({ status: 200, description: '返回消息列表' })
  findByTicket(@Param('ticketId') ticketId: string) {
    return this.ticketMessageService.findByTicket(ticketId);
  }

  // 翻译工单消息（玩家端可访问）
  @Public()
  @Post(':messageId/translate')
  @ApiOperation({ summary: '翻译工单消息' })
  @ApiParam({ name: 'messageId', description: '消息ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        targetLang: {
          type: 'string',
          description: '目标语言，如：zh, en, th等',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: '返回翻译后的消息' })
  translate(
    @Param('messageId') messageId: string,
    @Body('targetLang') targetLang?: string,
  ) {
    return this.ticketMessageService.translateMessage(messageId, targetLang);
  }
}
