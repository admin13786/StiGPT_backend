import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MessageService } from './message.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('messages')
@Controller('messages')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  // 玩家端API - 发送消息
  @Public()
  @Post()
  @ApiOperation({ summary: '发送消息（玩家端）' })
  @ApiResponse({ status: 201, description: '发送成功' })
  createPlayerMessage(@Body() createMessageDto: CreateMessageDto) {
    return this.messageService.create(createMessageDto, 'PLAYER');
  }

  // 玩家端API - 获取会话消息
  @Public()
  @Get('session/:sessionId')
  @ApiOperation({ summary: '获取会话消息（玩家端）' })
  @ApiParam({ name: 'sessionId', description: '会话ID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '限制数量',
  })
  @ApiResponse({ status: 200, description: '返回消息列表' })
  findBySession(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    return this.messageService.findBySession(
      sessionId,
      limit ? parseInt(limit) : undefined,
    );
  }

  // 管理端API - 客服发送消息
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Post('agent')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '客服发送消息（管理端）' })
  @ApiResponse({ status: 201, description: '发送成功' })
  createAgentMessage(
    @Body() createMessageDto: CreateMessageDto,
    @CurrentUser() user: any,
  ) {
    return this.messageService.create(createMessageDto, 'AGENT', user.id, user);
  }
  // 翻译消息
  @Public()
  @Post(':id/translate')
  @ApiOperation({ summary: '翻译消息' })
  @ApiParam({ name: 'id', description: '消息ID' })
  @ApiResponse({ status: 200, description: '返回翻译后的消息' })
  translate(@Param('id') id: string, @Body('targetLang') targetLang?: string) {
    return this.messageService.translateMessage(id, targetLang);
  }
}
