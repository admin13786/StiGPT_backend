import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { StigptChatService } from './stigpt-chat.service';

@Controller('stigpt')
@UseGuards(JwtAuthGuard)
export class StigptChatController {
  constructor(private readonly stigptChatService: StigptChatService) {}

  @Get('page-config')
  getPageConfig(@Query('routeKey') routeKey?: string) {
    return this.stigptChatService.getPageConfig(routeKey || 'webIdx');
  }

  @Get('me')
  getCurrentUser(@CurrentUser() user: any) {
    return user;
  }

  @Get('models')
  getModels(@Query('routeKey') routeKey?: string) {
    return this.stigptChatService.getModels(routeKey || 'webIdx');
  }

  @Get('examples')
  getExamples(
    @Query('routeKey') routeKey?: string,
    @Query('modelId') modelId?: string,
  ) {
    return this.stigptChatService.getExamples(routeKey || 'webIdx', modelId);
  }

  @Get('knowledge-bases')
  getKnowledgeBases(
    @CurrentUser() user: any,
    @Query('routeKey') routeKey?: string,
    @Query('routeMode') routeMode?: string,
  ) {
    return this.stigptChatService.getKnowledgeBases(
      user.id,
      routeKey || 'webIdx',
      routeMode,
    );
  }

  @Get('conversations')
  listConversations(
    @CurrentUser() user: any,
    @Query('routeKey') routeKey?: string,
  ) {
    return this.stigptChatService.listConversations(user.id, routeKey || 'webIdx');
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: any,
    @Body() dto: CreateConversationDto,
  ) {
    return this.stigptChatService.createConversation(user.id, dto);
  }

  @Get('conversations/:id')
  getConversation(@CurrentUser() user: any, @Param('id') id: string) {
    return this.stigptChatService.getConversation(user.id, id);
  }

  @Post('conversations/:id/messages')
  createMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.stigptChatService.createMessage(user.id, id, dto);
  }

  @Post('conversations/:id/messages/stream')
  streamMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
    @Res() response: Response,
  ) {
    return this.stigptChatService.streamMessage(user.id, id, dto, response);
  }
}
