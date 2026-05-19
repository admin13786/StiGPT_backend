import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AppLogger } from '../common/logger/app-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto, TransferToAgentDto } from './dto/create-session.dto';
import { SessionStatus } from '@prisma/client';
import { MessageType as MessageDtoType } from '../message/dto/create-message.dto';
import { MessageService } from '../message/message.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Inject, forwardRef } from '@nestjs/common';
import { TicketService } from '../ticket/ticket.service';
import { QueueService } from '../queue/queue.service';
import { SessionRagService } from './session-rag.service';
import { DifyService } from '../dify/dify.service';
import { ConfigService } from '@nestjs/config';

const TICKET_RELATION_INCLUDE = {
  game: true,
  server: true,
  attachments: true,
  ticketIssueTypes: {
    include: {
      issueType: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class SessionService {
  constructor(
    private readonly logger: AppLogger,
    private prisma: PrismaService,
    private messageService: MessageService,
    @Inject(forwardRef(() => WebsocketGateway))
    private websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => TicketService))
    private ticketService: TicketService,
    private queueService: QueueService,
    public sessionRagService: SessionRagService, // 公开以便 controller 访问
    private difyService: DifyService, // 添加 Dify 服务
    private configService: ConfigService, // 添加配置服务
  ) {
    this.logger.setContext('SessionService');
  }

  private enrichTicketWithIssueTypes<T extends { ticketIssueTypes?: any[] }>(
    ticket: T | null,
  ) {
    if (!ticket) return ticket;
    const issueTypes =
      ticket.ticketIssueTypes
        ?.map((item) => item.issueType)
        .filter((issueType) => Boolean(issueType)) ?? [];
    return {
      ...ticket,
      issueTypes,
    };
  }

  private enrichSession(session: any) {
    if (!session) return session;
    return {
      ...session,
      ticket: this.enrichTicketWithIssueTypes(session.ticket),
    };
  }

  private enrichSessions(sessions: any[]) {
    return sessions.map((session) => this.enrichSession(session));
  }

  // 创建会话（步骤1：AI引导）
  async create(createSessionDto: CreateSessionDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: createSessionDto.ticketId },
      include: { game: true },
    });

    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }

    // 检查是否已有会话
    const existingSession = await this.prisma.session.findFirst({
      where: {
        ticketId: createSessionDto.ticketId,
        status: { not: 'CLOSED' },
      },
    });

    if (existingSession) {
      return existingSession;
    }

    // 创建新会话
    const session = await this.prisma.session.create({
      data: {
        ticketId: createSessionDto.ticketId,
        status: 'PENDING',
      },
      include: {
        ticket: {
          include: {
            game: true,
            server: true,
          },
        },
      },
    });

    // 发送 AI 欢迎消息
    this.sendWelcomeMessage(session.id, ticket).catch((error) => {
      this.logger.error('Failed to send welcome message:', error);
    });

    // Return session immediately without waiting for AI
    const finalSession = this.enrichSession(session);

    // Business log: session created
    this.logger.logBusiness({
      action: 'session_created',
      sessionId: session.id,
      ticketId: createSessionDto.ticketId,
      status: session.status,
    });

    return finalSession;
  }

  /**
   * 发送欢迎消息
   */
  private async sendWelcomeMessage(sessionId: string, ticket: any) {
    try {
      const welcomeMessage = await this.messageService.create(
        {
          sessionId,
          content: '您好！我是科研之友 AI 助手，很高兴为您服务。请问有什么科研问题需要咨询吗？',
          messageType: MessageDtoType.TEXT,
        },
        'AI',
      );
      this.websocketGateway.notifyMessage(sessionId, welcomeMessage);
    } catch (error) {
      this.logger.error('Failed to send welcome message:', error);
    }
  }

  // 玩家发送消息，自动与 Dify 交互
  async handlePlayerMessage(
    sessionId: string,
    content: string,
    messageType: MessageDtoType = MessageDtoType.TEXT,
  ) {
    if (!content || !content.trim()) {
      throw new BadRequestException('消息内容不能为空');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        ticket: {
          include: {
            game: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // 检查会话状态，如果已关闭则不允许发送消息
    if (session.status === 'CLOSED') {
      throw new BadRequestException('会话已结束，无法发送消息');
    }

    // 检查工单状态，如果工单已解决则不允许发送消息
    if (session.ticket?.status === 'RESOLVED') {
      throw new BadRequestException('工单已解决，无法发送消息');
    }

    const playerMessage = await this.messageService.create(
      {
        sessionId,
        content,
        messageType,
      },
      'PLAYER',
    );
    this.websocketGateway.notifyMessage(sessionId, playerMessage);

    // 如果会话已被客服接入，不触发AI回复，只保存玩家消息
    if (session.status === 'IN_PROGRESS' && session.agentId) {
      return {
        playerMessage,
        aiMessage: null,
        difyStatus: null,
      };
    }

    if (messageType === MessageDtoType.TEXT) {
      // QUEUED 状态不触发 AI
      if (session.status === 'QUEUED') {
        return {
          playerMessage,
          aiMessage: null,
          difyStatus: session.difyStatus || null,
        };
      }

      // 使用 RAG 服务处理 AI 回复
      try {
        // 异步处理 AI 回复，不阻塞响应
        this.processAIReply(sessionId, content).catch((error) => {
          this.logger.error(
            `AI reply failed for session ${sessionId}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      } catch (error) {
        this.logger.error('Failed to trigger AI reply:', error);
      }
    }

    return {
      playerMessage,
      aiMessage: null,
      difyStatus: session.difyStatus || null,
    };
  }

  /**
   * 处理 AI 回复（异步）- 直接使用阿里云 API
   */
  private async processAIReply(sessionId: string, content: string) {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          ticket: {
            include: {
              game: true,
            },
          },
        },
      });

      if (!session) {
        this.logger.warn(`Session ${sessionId} not found for AI reply`);
        return;
      }

      // 检查会话状态
      if (session.status === 'CLOSED' || session.status === 'QUEUED') {
        return;
      }

      // 如果客服已接入，不触发 AI
      if (session.agentId) {
        return;
      }

      // 直接使用阿里云 API
      const apiKey = this.configService.get<string>('ALIYUN_API_KEY');
      
      if (!apiKey) {
        this.logger.warn('阿里云 API Key 未配置');
        const aiMessage = await this.messageService.create(
          {
            sessionId,
            content: '您好！我是科研之友 AI 助手。请问有什么可以帮助您的？',
            messageType: MessageDtoType.TEXT,
          },
          'AI',
        );
        this.websocketGateway.notifyMessage(sessionId, aiMessage);
        return;
      }

      try {
        this.logger.log(`Calling Aliyun API for session ${sessionId}`);
        
        // 调用阿里云 API
        const axios = require('axios');
        const response = await axios.post(
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
          {
            model: 'qwen-turbo',
            input: {
              messages: [
                {
                  role: 'system',
                  content: '你是科研之友 AI 助手，专门帮助用户解答科研项目相关的问题。你的回答要专业、准确、友好。',
                },
                {
                  role: 'user',
                  content: content,
                },
              ],
            },
            parameters: {
              temperature: 0.7,
              top_p: 0.8,
              max_tokens: 2000,
              result_format: 'message',
            },
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );

        const output = response.data?.output;
        if (!output || !output.choices || output.choices.length === 0) {
          throw new Error('阿里云 API 返回数据格式错误');
        }

        const aiText = output.choices[0].message?.content || '抱歉，我暂时无法回答这个问题。';

        // 创建 AI 消息
        const aiMessage = await this.messageService.create(
          {
            sessionId,
            content: aiText,
            messageType: MessageDtoType.TEXT,
          },
          'AI',
        );

        // 通过 WebSocket 发送消息
        this.websocketGateway.notifyMessage(sessionId, aiMessage);

        this.logger.log(`Aliyun AI reply sent for session ${sessionId}`);
      } catch (error: any) {
        this.logger.error(`Aliyun API call failed for session ${sessionId}:`, error.message);
        
        // 错误降级：发送默认消息
        const fallbackMessage = await this.messageService.create(
          {
            sessionId,
            content: '抱歉，我遇到了一些问题。请稍后再试，或者点击"转科研顾问"获取人工帮助。',
            messageType: MessageDtoType.TEXT,
          },
          'AI',
        );
        this.websocketGateway.notifyMessage(sessionId, fallbackMessage);
      }
    } catch (error) {
      this.logger.error(`Dify AI reply failed for session ${sessionId}:`, error);
      
      // 错误降级：发送默认消息
      try {
        const fallbackMessage = await this.messageService.create(
          {
            sessionId,
            content: '抱歉，我遇到了一些问题。请稍后再试，或者点击"转科研顾问"获取人工帮助。',
            messageType: MessageDtoType.TEXT,
            metadata: {
              suggestedOptions: ['转科研顾问', '重新提问'],
            },
          },
          'AI',
        );
        this.websocketGateway.notifyMessage(sessionId, fallbackMessage);
      } catch (fallbackError) {
        this.logger.error('Failed to send fallback message:', fallbackError);
      }
    }
  }

  async findOne(id: string, currentUser?: { id: string; role: string }) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        ticket: {
          include: {
            ...TICKET_RELATION_INCLUDE,
          },
        },
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // 如果是客服角色，只能查看分配给自己的会话
    if (currentUser && currentUser.role === 'AGENT') {
      if (session.agentId !== currentUser.id) {
        throw new NotFoundException('会话不存在或无权访问');
      }
    }

    return this.enrichSession(session);
  }

  // 获取待接入会话列表（管理端）
  async findQueuedSessions(currentUser?: { id: string; role: string }) {
    // 1. 获取 QUEUED 状态的会话
    const queuedWhere: any = {
      status: 'QUEUED',
    };

    // 如果是客服角色，只返回分配给该客服的会话（包括 agentId 为 null 的未分配会话）
    // 如果是管理员角色，返回所有待接入会话
    if (currentUser && currentUser.role === 'AGENT') {
      queuedWhere.OR = [{ agentId: currentUser.id }, { agentId: null }];
    } else if (currentUser && currentUser.role === 'ADMIN') {
      // 管理员可以看到所有待接入会话，不需要过滤
    } else {
      queuedWhere.agentId = null;
    }

    const queuedSessions = await this.prisma.session.findMany({
      where: queuedWhere,
      include: {
        ticket: {
          include: {
            ...TICKET_RELATION_INCLUDE,
          },
        },
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
      orderBy: [{ priorityScore: 'desc' }, { queuedAt: 'asc' }],
    });

    // 2. 获取 WAITING 状态的工单（没有活跃会话的）
    const waitingTicketsWhere: any = {
      status: 'WAITING',
      deletedAt: null,
      sessions: {
        none: {
          status: {
            in: ['PENDING', 'QUEUED', 'IN_PROGRESS'],
          },
        },
      },
    };

    const waitingTickets = await this.prisma.ticket.findMany({
      where: waitingTicketsWhere,
      include: {
        ...TICKET_RELATION_INCLUDE,
        sessions: {
          where: {
            status: 'CLOSED',
          },
          orderBy: {
            closedAt: 'desc',
          },
          take: 1,
          include: {
            agent: {
              select: {
                id: true,
                username: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'asc' }],
    });

    // 3. 将 WAITING 状态的工单转换为"虚拟会话"对象
    const virtualSessions = waitingTickets.map((ticket) => {
      const latestSession = ticket.sessions?.[0];
      return {
        id: `ticket-${ticket.id}`,
        ticketId: ticket.id,
        realSessionId: latestSession?.id || null,
        status: 'QUEUED' as SessionStatus,
        detectedIntent: latestSession?.detectedIntent || null,
        aiUrgency: latestSession?.aiUrgency || null,
        playerUrgency: latestSession?.playerUrgency || null,
        priorityScore: ticket.priorityScore || 0,
        queuePosition: null,
        queuedAt: latestSession?.closedAt || ticket.createdAt,
        transferAt: latestSession?.transferAt || null,
        startedAt: null,
        closedAt: latestSession?.closedAt || null,
        difyConversationId: latestSession?.difyConversationId || null,
        difyStatus: latestSession?.difyStatus || null,
        allowManualTransfer: false,
        transferReason: latestSession?.transferReason || null,
        transferIssueTypeId: latestSession?.transferIssueTypeId || null,
        manuallyAssigned: false,
        agentId: null,
        agent: null,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        ticket: {
          ...ticket,
          sessions: undefined,
        },
        messages: [],
        isVirtual: true,
      };
    });

    // 4. 合并并排序
    const allSessions = [
      ...this.enrichSessions(queuedSessions),
      ...virtualSessions,
    ];

    allSessions.sort((a, b) => {
      const scoreDiff = (b.priorityScore || 0) - (a.priorityScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aTime = a.queuedAt ? new Date(a.queuedAt).getTime() : 0;
      const bTime = b.queuedAt ? new Date(b.queuedAt).getTime() : 0;
      return aTime - bTime;
    });

    return allSessions;
  }

  // 会话列表（管理端/客服端）
  async findAll(
    query: {
      status?: SessionStatus;
      agentId?: string;
      gameId?: string;
      search?: string;
      transferredToAgent?: boolean;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    currentUser: { id: string; role: string },
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }

    const agentConditions: any[] = [];

    if (query.transferredToAgent !== undefined) {
      agentConditions.push(
        query.transferredToAgent === true
          ? { agentId: { not: null } }
          : { agentId: null },
      );
    }

    if (currentUser?.role === 'AGENT') {
      agentConditions.push({ agentId: currentUser.id });
    } else if (query.agentId) {
      agentConditions.push({ agentId: query.agentId });
    }

    if (agentConditions.length === 1) {
      Object.assign(where, agentConditions[0]);
    } else if (agentConditions.length > 1) {
      where.AND = [...(where.AND || []), ...agentConditions];
    }

    const ticketFilter: any = {};

    if (query.gameId) {
      ticketFilter.gameId = query.gameId;
    }

    if (query.search) {
      ticketFilter.OR = [
        {
          ticketNo: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
        {
          playerIdOrName: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (Object.keys(ticketFilter).length > 0) {
      where.ticket = ticketFilter;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = query.startDate;
      }
      if (query.endDate) {
        where.createdAt.lte = query.endDate;
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        include: {
          ticket: {
            include: {
              ...TICKET_RELATION_INCLUDE,
            },
          },
          agent: {
            select: {
              id: true,
              username: true,
              realName: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 20,
          },
        },
        orderBy: {
          [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
        },
        skip,
        take: pageSize,
      }),
      this.prisma.session.count({ where }),
    ]);

    const normalizedItems = this.enrichSessions(items);

    return {
      items: normalizedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // 客服接入会话
  async joinSession(sessionId: string, agentId: string) {
    const session = await this.findOne(sessionId);
    // TODO: Implement session assignment logic
    throw new BadRequestException('客服接入功能暂未实现');
  }

  // 管理员手动分配会话
  async assignSession(sessionId: string, agentId: string) {
    const session = await this.findOne(sessionId);
    // TODO: Implement session assignment logic
    throw new BadRequestException('手动分配功能暂未实现');
  }

  // 自动分配会话
  async autoAssignSession(sessionId: string) {
    const session = await this.findOne(sessionId);
    // TODO: Implement auto assignment logic
    throw new BadRequestException('自动分配功能暂未实现');
  }

  // 自动分配客服（只分配，不改变状态）
  async autoAssignAgentOnly(sessionId: string) {
    const session = await this.findOne(sessionId);
    // TODO: Implement auto assignment logic
    throw new BadRequestException('自动分配功能暂未实现');
  }

  // 转人工
  async transferToAgent(sessionId: string, transferDto: TransferToAgentDto) {
    // TODO: Implement transfer logic
    throw new BadRequestException('转人工功能暂未实现');
  }

  // 重新排序队列
  async reorderQueue() {
    // TODO: Implement queue reordering logic
    this.logger.log('重新排序队列（暂未实现）');
  }

  /**
   * 内部关闭会话的公共逻辑
   */
  private async performCloseSession(
    sessionId: string,
    closedBy: 'agent' | 'player',
    systemMessage: string,
  ) {
    // 获取会话信息
    const existingSession = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { ticketId: true, status: true, agentId: true },
    });

    if (!existingSession) {
      throw new NotFoundException('会话不存在');
    }

    // 如果会话已经关闭，直接返回
    if (existingSession.status === 'CLOSED') {
      return await this.findOne(sessionId);
    }

    // 更新会话状态
    const updatedSession = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        queuePosition: null,
        queuedAt: null,
      },
      include: {
        ticket: { include: { ...TICKET_RELATION_INCLUDE } },
        agent: { select: { id: true, username: true, realName: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    // 创建系统消息
    try {
      const msg = await this.messageService.createSystemMessage(sessionId, systemMessage);
      this.websocketGateway.notifyMessage(sessionId, msg);
    } catch (error) {
      this.logger.warn('创建系统消息失败:', error);
    }

    // 从 Redis 队列移除会话
    await this.queueService.removeFromQueueWithRetry(sessionId, existingSession.agentId);

    // TODO: 重新排序队列
    // await this.sessionQueueService.reorderQueue();

    // 关键业务日志
    this.logger.logBusiness({
      action: 'session_closed',
      sessionId,
      ticketId: existingSession.ticketId,
      agentId: updatedSession.agentId,
      closedBy,
    });

    // 通过 WebSocket 通知
    const normalizedSession = this.enrichSession(updatedSession);
    this.websocketGateway.notifySessionUpdate(sessionId, normalizedSession);

    // 检查并更新关联工单的状态
    if (existingSession.ticketId) {
      await this.ticketService.checkAndUpdateTicketStatus(existingSession.ticketId);
    }

    return normalizedSession;
  }

  // 结束会话（客服端）
  async closeSession(sessionId: string) {
    return this.performCloseSession(sessionId, 'agent', '客服已结束会话');
  }

  // 结束会话（玩家端）
  async closeByPlayer(sessionId: string) {
    return this.performCloseSession(sessionId, 'player', '玩家已离开会话');
  }

  // 通过工单ID查找活跃会话
  async findActiveSessionByTicket(ticketId: string) {
    const session = await this.prisma.session.findFirst({
      where: {
        ticketId,
        status: {
          in: ['PENDING', 'QUEUED', 'IN_PROGRESS'],
        },
      },
      include: {
        ticket: {
          include: {
            ...TICKET_RELATION_INCLUDE,
          },
        },
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!session) {
      return null;
    }

    return this.enrichSession(session);
  }

  // 通过工单ID接入会话（如果会话不存在则创建，如果已关闭则重新激活）
  async joinSessionByTicketId(ticketId: string, agentId: string) {
    // 1. 检查工单是否存在
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }

    // 2. 检查工单状态
    if (ticket.status === 'RESOLVED') {
      throw new BadRequestException('该工单已解决，无法接入');
    }

    // 3. 查找最新的会话（包括已关闭的）
    const latestSession = await this.prisma.session.findFirst({
      where: {
        ticketId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 4. 如果有已关闭的会话，重新激活它
    if (latestSession && latestSession.status === 'CLOSED') {
      return await this.joinSession(latestSession.id, agentId);
    }

    // 5. 如果有活跃会话，直接接入
    if (
      latestSession &&
      ['PENDING', 'QUEUED', 'IN_PROGRESS'].includes(latestSession.status)
    ) {
      return await this.joinSession(latestSession.id, agentId);
    }

    // 6. 如果没有会话，创建新会话
    const ticketFull = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        game: true,
        server: true,
      },
    });

    if (!ticketFull) {
      throw new NotFoundException('工单不存在');
    }

    // 创建新会话
    const newSession = await this.prisma.session.create({
      data: {
        ticketId,
        agentId,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        priorityScore: ticketFull.priorityScore || 0,
        manuallyAssigned: true,
      },
      include: {
        ticket: {
          include: {
            ...TICKET_RELATION_INCLUDE,
          },
        },
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // 更新工单状态为处理中
    await this.ticketService.updateStatus(ticketId, 'IN_PROGRESS');

    // 更新用户在线状态
    await this.prisma.user.update({
      where: { id: agentId },
      data: { isOnline: true },
    });

    const normalizedSession = this.enrichSession(newSession);

    // 通知 WebSocket 客户端
    this.websocketGateway.notifySessionUpdate(
      normalizedSession.id,
      normalizedSession,
    );

    return normalizedSession;
  }

  /**
   * 通过工单ID获取所有历史消息
   * 用于玩家端查看完整的对话历史，包括跨会话的消息
   */
  async getTicketMessages(ticketId: string) {
    // 验证工单存在
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }

    // 获取工单的所有会话
    const sessions = await this.prisma.session.findMany({
      where: { ticketId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      return [];
    }

    // 获取所有会话的消息，按时间排序
    const messages = await this.prisma.message.findMany({
      where: {
        sessionId: { in: sessionIds },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    this.logger.log(
      `[getTicketMessages] 工单=${ticketId}，会话数=${sessions.length}，消息数=${messages.length}`,
    );

    return messages;
  }
}
