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
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AppLogger } from '../common/logger/app-logger.service';

@ApiTags('tickets')
@Controller('tickets')
export class TicketController {
  private readonly logger: AppLogger;

  constructor(
    private readonly ticketService: TicketService,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(TicketController.name);
  }

  // 玩家端API - 查询玩家未完成工单列表
  @Public()
  @Post('query-open-tickets')
  @ApiOperation({ summary: '查询玩家未完成工单列表' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '游戏ID' },
        serverId: { type: 'string', description: '区服ID（可选）' },
        serverName: { type: 'string', description: '区服名称（可选）' },
        playerIdOrName: { type: 'string', description: '玩家ID或昵称' },
      },
      required: ['gameId', 'playerIdOrName'],
    },
  })
  @ApiResponse({ status: 200, description: '返回工单列表' })
  queryOpenTickets(
    @Body()
    body: {
      gameId: string;
      serverId?: string;
      serverName?: string;
      playerIdOrName: string;
    },
  ) {
    return this.ticketService.findOpenTicketsByPlayer(
      body.gameId,
      body.serverId || null,
      body.serverName || null,
      body.playerIdOrName,
    );
  }

  // 玩家端API - 检查未关闭工单
  @Public()
  @Post('check-open')
  @ApiOperation({ summary: '检查未关闭工单' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        gameId: { type: 'string' },
        serverId: { type: 'string' },
        serverName: { type: 'string' },
        playerIdOrName: { type: 'string' },
      },
      required: ['gameId', 'playerIdOrName'],
    },
  })
  @ApiResponse({ status: 200, description: '检查结果' })
  checkOpenTicket(
    @Body()
    body: {
      gameId: string;
      serverId?: string;
      serverName?: string;
      playerIdOrName: string;
    },
  ) {
    return this.ticketService.checkOpenTicket(
      body.gameId,
      body.serverId || null,
      body.serverName || null,
      body.playerIdOrName,
    );
  }

  // 玩家端API - 检查相同问题类型的未完成工单
  @Public()
  @Post('check-open-by-issue-type')
  @ApiOperation({ summary: '检查相同问题类型的未完成工单' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        gameId: { type: 'string' },
        serverId: { type: 'string' },
        playerIdOrName: { type: 'string' },
        issueTypeId: { type: 'string' },
      },
      required: ['gameId', 'playerIdOrName', 'issueTypeId'],
    },
  })
  @ApiResponse({ status: 200, description: '检查结果' })
  checkOpenTicketByIssueType(
    @Body()
    body: {
      gameId: string;
      serverId?: string; // 可选，可能是 serverId 或 serverName
      playerIdOrName: string;
      issueTypeId: string;
    },
  ) {
    return this.ticketService.checkOpenTicketByIssueType(
      body.gameId,
      body.serverId || null,
      body.playerIdOrName,
      body.issueTypeId,
    );
  }

  // 玩家端API - 创建工单
  @Public()
  @Post()
  @ApiOperation({ summary: '创建工单' })
  @ApiBody({ type: CreateTicketDto })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(@Body() createTicketDto: CreateTicketDto) {
    try {
      return await this.ticketService.create(createTicketDto);
    } catch (error) {
      this.logger.error(
        '工单创建控制器错误',
        error instanceof Error ? error.stack : undefined,
        {
          gameId: createTicketDto.gameId,
          playerIdOrName: createTicketDto.playerIdOrName,
          issueTypeIds: createTicketDto.issueTypeIds,
          requestData: createTicketDto,
        },
      );
      throw error;
    }
  }

  // 玩家端API - 根据token获取工单
  @Public()
  @Get('by-token/:token')
  @ApiOperation({ summary: '根据token获取工单' })
  @ApiParam({ name: 'token', description: '工单token' })
  @ApiResponse({ status: 200, description: '返回工单信息' })
  findByToken(@Param('token') token: string) {
    return this.ticketService.findByToken(token);
  }

  // 玩家端API - 根据工单号获取工单
  @Public()
  @Get('by-ticket-no/:ticketNo')
  @ApiOperation({ summary: '根据工单号获取工单' })
  @ApiParam({ name: 'ticketNo', description: '工单号' })
  @ApiResponse({ status: 200, description: '返回工单信息' })
  findByTicketNo(@Param('ticketNo') ticketNo: string) {
    return this.ticketService.findByTicketNo(ticketNo);
  }

  // 玩家端API - 根据工单号获取工单消息列表
  @Public()
  @Get('by-ticket-no/:ticketNo/messages')
  @ApiOperation({ summary: '根据工单号获取工单消息列表' })
  @ApiParam({ name: 'ticketNo', description: '工单号' })
  @ApiResponse({ status: 200, description: '返回消息列表' })
  getMessagesByTicketNo(@Param('ticketNo') ticketNo: string) {
    return this.ticketService.getMessagesByTicketNo(ticketNo);
  }

  // 玩家端API - 根据token获取工单消息列表
  @Public()
  @Get('by-token/:token/messages')
  @ApiOperation({ summary: '根据token获取工单消息列表' })
  @ApiParam({ name: 'token', description: '工单token' })
  @ApiResponse({ status: 200, description: '返回消息列表' })
  getMessagesByToken(@Param('token') token: string) {
    return this.ticketService.getMessagesByToken(token);
  }

  // 玩家端API - 根据token发送工单消息
  @Public()
  @Post('by-token/:token/messages')
  @ApiOperation({ summary: '根据token发送工单消息' })
  @ApiParam({ name: 'token', description: '工单token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
      },
      required: ['content'],
    },
  })
  @ApiResponse({ status: 201, description: '发送成功' })
  sendMessageByToken(
    @Param('token') token: string,
    @Body() body: { content: string },
  ) {
    return this.ticketService.sendMessageByToken(token, body.content);
  }

  // 玩家端API - 根据token更新工单状态（用于玩家手动关闭工单）
  @Public()
  @Patch('by-token/:token/status')
  @ApiOperation({
    summary: '根据token更新工单状态（玩家端）',
    description: `
      玩家通过此端点手动更新工单状态。主要用于玩家标记问题已解决。
      
      **工单状态说明：**
      - WAITING: 等待客服响应
      - IN_PROGRESS: 客服处理中
      - RESOLVED: 已解决/已关闭
      
      **自动关闭规则：**
      - WAITING 状态工单：72小时无活动后自动关闭
      - IN_PROGRESS 状态工单（客服已回复）：24小时无活动后自动关闭
      
      **关闭元数据：**
      当工单状态更新为 RESOLVED 时，系统会自动记录：
      - closedAt: 关闭时间戳
      - closureMetadata: 包含关闭方式（manual/auto_timeout_waiting/auto_timeout_replied）和关闭者信息
    `,
  })
  @ApiParam({
    name: 'token',
    description: '工单访问令牌，用于验证玩家身份',
  })
  @ApiBody({ type: UpdateTicketStatusDto })
  @ApiResponse({
    status: 200,
    description: '更新成功，返回更新后的工单对象',
    schema: {
      example: {
        id: 'ticket-uuid',
        ticketNo: 'T20251225001',
        status: 'RESOLVED',
        closedAt: '2025-12-25T10:00:00.000Z',
        closureMetadata: {
          method: 'manual',
          closedBy: 'player-123',
          closedAt: '2025-12-25T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '工单不存在或token无效',
  })
  @ApiResponse({
    status: 400,
    description: '无效的状态值，状态必须是 WAITING、IN_PROGRESS 或 RESOLVED 之一',
  })
  async updateStatusByToken(
    @Param('token') token: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    try {
      // 通过 token 获取工单
      const ticket = await this.ticketService.findByToken(token);

      // 调用更新状态方法
      return await this.ticketService.updateStatus(ticket.id, dto.status, {
        closureMethod: dto.status === 'RESOLVED' ? 'manual' : undefined,
        closedBy: dto.closedBy,
      });
    } catch (error) {
      this.logger.error(
        '玩家更新工单状态失败',
        error instanceof Error ? error.stack : undefined,
        {
          token,
          status: dto.status,
        },
      );
      throw error;
    }
  }

  // 管理端API - 获取工单列表
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Throttle({
    default: { limit: 1000, ttl: 60000 },
  })
  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取工单列表（管理端）' })
  @ApiQuery({ name: 'status', required: false, description: '工单状态' })
  @ApiQuery({ name: 'priority', required: false, description: '优先级' })
  @ApiQuery({ name: 'issueTypeId', required: false, description: '问题类型ID' })
  @ApiQuery({ name: 'gameId', required: false, description: '游戏ID' })
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
  @ApiResponse({ status: 200, description: '返回工单列表' })
  findAll(@Query() query: any, @CurrentUser() user: any) {
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    if (startDate) startDate.setHours(0, 0, 0, 0);
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    return this.ticketService.findAll(
      {
        status: query.status,
        priority: query.priority,
        issueTypeId: query.issueTypeId,
        gameId: query.gameId,
        startDate:
          startDate && isNaN(startDate.getTime()) ? undefined : startDate,
        endDate: endDate && isNaN(endDate.getTime()) ? undefined : endDate,
        page: query.page ? parseInt(query.page) : 1,
        pageSize: query.pageSize ? parseInt(query.pageSize) : 10,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      user,
    );
  }

  // 管理端API - 获取工单详情
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取工单详情（管理端）' })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiResponse({ status: 200, description: '返回工单详情' })
  @ApiResponse({ status: 404, description: '工单不存在' })
  findOne(@Param('id') id: string) {
    return this.ticketService.findOne(id);
  }

  // 管理端API - 更新工单状态
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Patch(':id/status')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: '更新工单状态（管理端）',
    description: `
      客服/管理员通过此端点更新工单状态。
      
      **工单状态说明：**
      - WAITING: 等待客服响应
      - IN_PROGRESS: 客服处理中
      - RESOLVED: 已解决/已关闭
      
      **状态转换规则：**
      - 任何状态都可以转换为 RESOLVED
      - WAITING 可以转换为 IN_PROGRESS（客服开始处理）
      - IN_PROGRESS 可以转换回 WAITING（需要更多信息）
      
      **关闭元数据：**
      当工单状态更新为 RESOLVED 时，系统会自动记录关闭时间和关闭方式。
    `,
  })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiBody({ type: UpdateTicketStatusDto })
  @ApiResponse({
    status: 200,
    description: '更新成功，返回更新后的工单对象',
    schema: {
      example: {
        id: 'ticket-uuid',
        ticketNo: 'T20251225001',
        status: 'RESOLVED',
        closedAt: '2025-12-25T10:00:00.000Z',
        closureMetadata: {
          method: 'manual',
          closedBy: 'agent-456',
          closedAt: '2025-12-25T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '工单不存在',
  })
  @ApiResponse({
    status: 400,
    description: '无效的状态值，状态必须是 WAITING、IN_PROGRESS 或 RESOLVED 之一',
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user?: any,
  ) {
    try {
      return await this.ticketService.updateStatus(id, dto.status, {
        closureMethod: dto.status === 'RESOLVED' ? 'manual' : undefined,
        closedBy: dto.closedBy || user?.id,
      });
    } catch (error) {
      this.logger.error(
        '更新工单状态失败',
        error instanceof Error ? error.stack : undefined,
        {
          ticketId: id,
          status: dto.status,
          userId: user?.id,
        },
      );
      throw error;
    }
  }

  // 管理端API - 更新工单优先级
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Patch(':id/priority')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '更新工单优先级（管理端）' })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
      },
      required: ['priority'],
    },
  })
  @ApiResponse({ status: 200, description: '更新成功' })
  updatePriority(@Param('id') id: string, @Body() body: { priority: string }) {
    return this.ticketService.updatePriority(id, body.priority);
  }

  // 管理端API - 发送工单消息（客服回复工单）
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Post(':id/messages')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '发送工单消息（管理端）' })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
      },
      required: ['content'],
    },
  })
  @ApiResponse({ status: 201, description: '发送成功' })
  sendTicketMessage(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    return this.ticketService.sendMessageByTicketId(id, user.id, body.content);
  }

  // 管理端API - 获取工单消息列表
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Get(':id/messages')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '获取工单消息列表（管理端）' })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiResponse({ status: 200, description: '返回消息列表' })
  getTicketMessages(@Param('id') id: string) {
    return this.ticketService.getMessagesByTicketId(id);
  }

  // 管理端API - 手动标记工单为已处理
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'AGENT')
  @Patch(':id/resolve')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: '手动标记工单为已处理（管理端）' })
  @ApiParam({ name: 'id', description: '工单ID' })
  @ApiResponse({ status: 200, description: '标记成功' })
  @ApiResponse({ status: 404, description: '工单不存在' })
  markAsResolved(@Param('id') id: string) {
    return this.ticketService.markAsResolved(id);
  }
}
