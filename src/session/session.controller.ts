import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { SessionService } from './session.service';
import { CreateSessionDto, TransferToAgentDto } from './dto/create-session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { getDifyThrottleKey } from '../common/guards/throttle-keys';

@ApiTags('sessions')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // 玩家端API - 创建会话
  @Public()
  @Throttle({
    'dify-api': {
      limit: 100,
      ttl: 60000,
      getTracker: getDifyThrottleKey,
    },
  })
  @Post()
  @ApiOperation({ summary: '创建会话（玩家端）' })
  @ApiResponse({ status: 201, description: '创建成功' })
  create(@Body() createSessionDto: CreateSessionDto) {
    return this.sessionService.create(createSessionDto);
  }

  // 玩家端API - 发送消息并触发AI回复
  @Public()
  @Throttle({
    'dify-api': {
      limit: 100,
      ttl: 60000,
      getTracker: getDifyThrottleKey,
    },
  })
  @Post(':id/messages')
  @ApiOperation({ summary: '发送消息并触发AI回复（玩家端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        messageType: { type: 'string', enum: ['TEXT', 'IMAGE'] },
      },
      required: ['content'],
    },
  })
  @ApiResponse({ status: 200, description: '发送成功' })
  sendPlayerMessage(
    @Param('id') id: string,
    @Body()
    body: {
      content: string;
      messageType?: 'TEXT' | 'IMAGE';
    },
  ) {
    return this.sessionService.handlePlayerMessage(
      id,
      body.content,
      body.messageType ? (body.messageType as any) : undefined,
    );
  }

  // 玩家端API - 获取会话详情
  @Public()
  @Get(':id')
  @ApiOperation({ summary: '获取会话详情（玩家端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '返回会话信息' })
  findOne(@Param('id') id: string) {
    return this.sessionService.findOne(id);
  }

  // 玩家端API - 转人工
  @Public()
  @Post(':id/transfer-to-agent')
  @ApiOperation({ summary: '转人工客服（玩家端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiBody({ type: TransferToAgentDto })
  @ApiResponse({ status: 200, description: '转接成功' })
  transferToAgent(
    @Param('id') id: string,
    @Body() transferDto: TransferToAgentDto,
  ) {
    return this.sessionService.transferToAgent(id, transferDto);
  }

  // 管理端API - 获取待接入会话列表
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Throttle({
    default: { limit: 1000, ttl: 60000 },
  })
  @Get('workbench/queued')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取待接入会话列表（管理端）' })
  @ApiResponse({ status: 200, description: '返回待接入会话列表' })
  findQueuedSessions(@CurrentUser() user: any) {
    return this.sessionService.findQueuedSessions(user);
  }

  // 管理端API - 会话列表（支持管理员查看全部，客服仅查看自己的会话）
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Throttle({
    default: { limit: 1000, ttl: 60000 },
  })
  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取会话列表（管理端）' })
  @ApiQuery({ name: 'status', required: false, description: '会话状态' })
  @ApiQuery({ name: 'agentId', required: false, description: '客服ID' })
  @ApiQuery({ name: 'gameId', required: false, description: '游戏ID' })
  @ApiQuery({ name: 'search', required: false, description: '搜索关键词' })
  @ApiQuery({ name: 'transferredToAgent', required: false, type: Boolean })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: '开始日期，格式 YYYY-MM-DD',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: '结束日期，格式 YYYY-MM-DD',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: '返回会话列表' })
  findAll(@Query() query: any, @CurrentUser() user: any) {
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    if (startDate) startDate.setHours(0, 0, 0, 0);
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    return this.sessionService.findAll(
      {
        status: query.status,
        agentId: query.agentId,
        gameId: query.gameId,
        search: query.search,
        startDate:
          startDate && isNaN(startDate.getTime()) ? undefined : startDate,
        endDate: endDate && isNaN(endDate.getTime()) ? undefined : endDate,
        transferredToAgent:
          query.transferredToAgent !== undefined
            ? query.transferredToAgent === 'true'
            : undefined,
        page: query.page ? parseInt(query.page) : 1,
        pageSize: query.pageSize ? parseInt(query.pageSize) : 10,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc',
      },
      user,
    );
  }

  // 管理端API - 获取会话详情（管理端，需要权限检查）
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Get('workbench/:id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取会话详情（管理端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '返回会话信息' })
  findOneForWorkbench(@Param('id') id: string, @CurrentUser() user: any) {
    return this.sessionService.findOne(id, user);
  }

  // 管理端API - 客服接入会话
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Post(':id/join')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '客服接入会话（管理端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '接入成功' })
  joinSession(@Param('id') id: string, @CurrentUser() user: any) {
    return this.sessionService.joinSession(id, user.id);
  }

  // ✅ 新增：管理端API - 通过工单ID接入会话（如果会话不存在则创建，如果已关闭则重新激活）
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Post('by-ticket/:ticketId/join')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '通过工单ID接入会话（管理端）' })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiResponse({ status: 200, description: '接入成功' })
  joinSessionByTicketId(
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: any,
  ) {
    return this.sessionService.joinSessionByTicketId(ticketId, user.id);
  }

  // 管理端API - 结束会话
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Patch(':id/close')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '结束会话（管理端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '结束成功' })
  closeSession(@Param('id') id: string) {
    return this.sessionService.closeSession(id);
  }

  // 玩家端API - 结束聊天
  @Public()
  @Patch(':id/close-player')
  @ApiOperation({ summary: '结束聊天（玩家端）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '结束成功' })
  closeByPlayer(@Param('id') id: string) {
    return this.sessionService.closeByPlayer(id);
  }

  // 玩家端API - 通过工单ID获取所有历史消息
  @Public()
  @Get('by-ticket/:ticketId/messages')
  @ApiOperation({ summary: '通过工单ID获取所有历史消息（玩家端）' })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiResponse({ status: 200, description: '返回所有历史消息' })
  async getTicketMessages(@Param('ticketId') ticketId: string) {
    return this.sessionService.getTicketMessages(ticketId);
  }

  // 玩家端API - 通过工单ID查找活跃会话
  @Public()
  @Get('by-ticket/:ticketId/active')
  @ApiOperation({ summary: '通过工单ID查找活跃会话（玩家端）' })
  @ApiParam({ name: 'ticketId', description: '工单ID' })
  @ApiResponse({ status: 200, description: '返回活跃会话' })
  findActiveSessionByTicket(@Param('ticketId') ticketId: string) {
    return this.sessionService.findActiveSessionByTicket(ticketId);
  }

  // 管理端API - 管理员手动分配会话给指定客服
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post(':id/assign')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '管理员手动分配会话给指定客服' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: '客服ID' },
      },
      required: ['agentId'],
    },
  })
  @ApiResponse({ status: 200, description: '分配成功' })
  assignSession(@Param('id') id: string, @Body() body: { agentId: string }) {
    return this.sessionService.assignSession(id, body.agentId);
  }

  // 管理端API - 自动分配会话（根据客服当前接待数量）
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Post(':id/auto-assign')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '自动分配会话（根据客服当前接待数量）' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiResponse({ status: 200, description: '自动分配成功' })
  autoAssignSession(@Param('id') id: string) {
    return this.sessionService.autoAssignSession(id);
  }

  // ==================== RAG 相关端点 ====================

  @Post(':id/rag/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '启用会话的 RAG 功能' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: '知识库ID' },
        personaId: { type: 'string', description: '数字人配置ID（可选）' },
      },
      required: ['kbId'],
    },
  })
  async enableRag(
    @Param('id') id: string,
    @Body() body: { kbId: string; personaId?: string },
  ) {
    const sessionRagService = this.sessionService['sessionRagService'];
    return sessionRagService.enableRag(id, body.kbId, body.personaId);
  }

  @Post(':id/rag/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '禁用会话的 RAG 功能' })
  @ApiParam({ name: 'id', description: '会话ID' })
  async disableRag(@Param('id') id: string) {
    const sessionRagService = this.sessionService['sessionRagService'];
    return sessionRagService.disableRag(id);
  }

  @Post(':id/rag/query')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '在会话中进行 RAG 查询' })
  @ApiParam({ name: 'id', description: '会话ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '用户问题' },
      },
      required: ['query'],
    },
  })
  async ragQuery(
    @Param('id') id: string,
    @Body() body: { query: string },
    @CurrentUser() user: any,
  ) {
    const sessionRagService = this.sessionService['sessionRagService'];
    return sessionRagService.handleRagQuery(id, body.query, user.userId);
  }

  @Get(':id/rag/config')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取会话的 RAG 配置' })
  @ApiParam({ name: 'id', description: '会话ID' })
  async getRagConfig(@Param('id') id: string) {
    const sessionRagService = this.sessionService['sessionRagService'];
    return sessionRagService.getRagConfig(id);
  }
}
