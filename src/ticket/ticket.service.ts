import { Injectable, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { AppLogger } from '../common/logger/app-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto, TicketResponseDto } from './dto/create-ticket.dto';
import { TicketPriorityService } from './ticket-priority.service';
import { TicketMessageService } from '../ticket-message/ticket-message.service';
import { MessageService } from '../message/message.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { SessionService } from '../session/session.service';
import * as crypto from 'crypto';

@Injectable()
export class TicketService {
  constructor(
    private readonly logger: AppLogger,
    private prisma: PrismaService,
    private priorityService: TicketPriorityService,
    private ticketMessageService: TicketMessageService,
    private messageService: MessageService,
    @Inject(forwardRef(() => WebsocketGateway))
    private websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => SessionService))
    private sessionService: SessionService,
  ) {
    this.logger.setContext('TicketService');
  }

  // 生成工单编号 - 使用简单的时间戳 + 随机数
  private generateTicketNo(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `TK${timestamp}${random}`.toUpperCase();
  }

  // 生成访问令牌
  private generateToken(): string {
    return (
      crypto.randomBytes(32).toString('hex') + '-' + Date.now().toString(36)
    );
  }

  // ============== 查询方法 ==============

  // 检查玩家是否有未关闭的工单
  async checkOpenTicket(
    gameId: string,
    serverId: string | null,
    serverName: string | null,
    playerIdOrName: string,
  ) {
    const where: any = {
      gameId,
      playerIdOrName,
      status: { in: ['WAITING', 'IN_PROGRESS'] },
    };

    if (serverId) {
      where.serverId = serverId;
    } else if (serverName) {
      where.serverName = serverName;
    }

    return this.prisma.ticket.findFirst({ where });
  }

  // 查询玩家所有未完成工单（用于工单查询页面）
  async findOpenTicketsByPlayer(
    gameId: string,
    serverId: string | null,
    serverName: string | null,
    playerIdOrName: string,
  ) {
    const where: any = {
      gameId,
      playerIdOrName,
      status: { in: ['WAITING', 'IN_PROGRESS'] },
    };

    if (serverId) {
      where.serverId = serverId;
    } else if (serverName) {
      where.serverName = serverName;
    }

    return this.prisma.ticket.findMany({ where });
  }

  // 检查玩家是否有相同问题类型的未完成工单
  async checkOpenTicketByIssueType(
    gameId: string,
    serverIdOrName: string | null,
    playerIdOrName: string,
    issueTypeId: string,
  ) {
    return this.prisma.ticket.findFirst({
      where: {
        gameId,
        playerIdOrName,
        status: { in: ['WAITING', 'IN_PROGRESS'] },
        ticketIssueTypes: {
          some: { issueTypeId },
        },
      },
    });
  }

  // 根据token获取工单
  async findByToken(token: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { token },
    });
    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }
    return ticket;
  }

  // 获取工单详情
  async findOne(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        game: true,
        server: true,
        ticketIssueTypes: {
          include: { issueType: true },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }
    return ticket;
  }

  // 根据工单号获取工单（玩家端）
  async findByTicketNo(ticketNo: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { ticketNo },
    });
    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }
    return ticket;
  }

  // 根据工单号获取工单消息列表（玩家端）
  async getMessagesByTicketNo(ticketNo: string) {
    const ticket = await this.findByTicketNo(ticketNo);
    return this.prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  // 根据token获取工单消息列表（玩家端）
  async getMessagesByToken(token: string) {
    const ticket = await this.findByToken(token);
    return this.prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  // 根据工单ID获取工单消息列表（管理端）
  async getMessagesByTicketId(ticketId: string) {
    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // 获取工单列表（管理端）
  async findAll(
    query: {
      status?: string;
      priority?: string;
      issueTypeId?: string;
      gameId?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    currentUser?: { id: string; role: string },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.gameId) where.gameId = query.gameId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = query.startDate;
      if (query.endDate) where.createdAt.lte = query.endDate;
    }
    if (query.issueTypeId) {
      where.ticketIssueTypes = {
        some: { issueTypeId: query.issueTypeId },
      };
    }

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          game: true,
          server: true,
          ticketIssueTypes: {
            include: { issueType: true },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      data: tickets,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ============== 状态管理方法 ==============

  // 更新工单状态
  async updateStatus(
    id: string,
    status: string,
    metadata?: {
      closureMethod?:
      | 'manual'
      | 'auto_timeout_waiting'
      | 'auto_timeout_replied';
      closedBy?: string;
    },
  ) {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        status: status as any,
        closedAt: status === 'RESOLVED' ? new Date() : null,
      },
    });
  }

  // 更新工单优先级
  async updatePriority(id: string, priority: string) {
    return this.prisma.ticket.update({
      where: { id },
      data: { priority: priority as any },
    });
  }

  /**
   * 检查并更新工单状态
   * 当工单的所有会话都已关闭时，将工单状态更新为 RESOLVED
   */
  async checkAndUpdateTicketStatus(ticketId: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { ticketId },
    });

    const allClosed = sessions.every((s) => s.status === 'CLOSED');
    if (allClosed && sessions.length > 0) {
      await this.updateStatus(ticketId, 'RESOLVED');
    }
  }

  /**
   * 手动标记工单为已处理
   */
  async markAsResolved(ticketId: string): Promise<void> {
    await this.updateStatus(ticketId, 'RESOLVED');
  }

  /**
   * 定时任务：检查超过3天没有继续处理的工单
   */
  async checkStaleTickets(): Promise<void> {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const staleTickets = await this.prisma.ticket.findMany({
      where: {
        status: { in: ['WAITING', 'IN_PROGRESS'] },
        updatedAt: { lt: threeDaysAgo },
      },
    });

    for (const ticket of staleTickets) {
      await this.updateStatus(ticket.id, 'RESOLVED', {
        closureMethod: 'auto_timeout_waiting',
      });
    }
  }

  // ============== 分配方法 ==============

  /**
   * 自动分配工单给客服（当客服上线时调用）
   */
  async autoAssignWaitingTickets(agentId: string): Promise<void> {
    // 简单实现：暂不自动分配
    this.logger.log(`客服 ${agentId} 上线，暂不自动分配工单`);
  }

  // ============== 核心业务方法 ==============

  // 创建工单
  async create(createTicketDto: CreateTicketDto): Promise<TicketResponseDto> {
    try {
      const ticketNo = this.generateTicketNo();
      const token = this.generateToken();
      const {
        occurredAt,
        serverId: rawServerId,
        serverName: rawServerName,
        issueTypeIds,
        ...otherData
      } = createTicketDto;
      let serverId = rawServerId ?? null;
      let serverName = rawServerName ?? null;

      // 验证必填字段
      if (!createTicketDto.gameId) {
        throw new Error('游戏ID不能为空');
      }
      if (!createTicketDto.playerIdOrName) {
        throw new Error('玩家ID或昵称不能为空');
      }
      if (!createTicketDto.description) {
        throw new Error('问题描述不能为空');
      }
      // 问题类型现在是可选的，不再强制验证
      // if (!issueTypeIds || issueTypeIds.length === 0) {
      //   throw new Error('问题类型不能为空');
      // }

      // 验证游戏是否存在
      const game = await this.prisma.game.findUnique({
        where: { id: createTicketDto.gameId },
        select: { id: true, enabled: true, deletedAt: true },
      });
      if (!game || game.deletedAt) {
        throw new Error('游戏不存在或已被删除');
      }
      if (!game.enabled) {
        throw new Error('游戏已禁用');
      }

      // 验证问题类型是否存在且启用，并获取完整信息
      let issueTypes: Array<{
        id: string;
        name: string;
        enabled: boolean;
        requireDirectTransfer: boolean;
      }> = [];
      if (issueTypeIds && issueTypeIds.length > 0) {
        issueTypes = await this.prisma.issueType.findMany({
          where: {
            id: { in: issueTypeIds },
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            enabled: true,
            requireDirectTransfer: true,
          },
        });

        if (issueTypes.length !== issueTypeIds.length) {
          const foundIds = issueTypes.map((t) => t.id);
          const missingIds = issueTypeIds.filter(
            (id) => !foundIds.includes(id),
          );
          throw new Error(`问题类型不存在: ${missingIds.join(', ')}`);
        }

        const disabledTypes = issueTypes.filter((t) => !t.enabled);
        if (disabledTypes.length > 0) {
          throw new Error(
            `问题类型已禁用: ${disabledTypes.map((t) => t.id).join(', ')}`,
          );
        }
      }

      if (serverId) {
        try {
          const serverExists = await this.prisma.server.findUnique({
            where: { id: serverId },
          });

          if (!serverExists) {
            this.logger.warn(
              `服务器(${serverId})不存在，将以 serverName 形式保存玩家输入`,
            );
            serverName = serverName ?? serverId;
            serverId = null;
          }
        } catch (error) {
          this.logger.error('检查服务器失败:', error);
          // 继续执行，使用 serverName
          serverName = serverName ?? rawServerId ?? null;
          serverId = null;
        }
      }

      // 检查是否需要直接转人工（使用已查询的问题类型）
      const directTransferType = issueTypes.find(
        (type) => type.requireDirectTransfer,
      );
      const requiresDirectTransfer = !!directTransferType;

      // 如果需要直接转人工，状态设置为 WAITING（待人工处理）
      // 否则设置为 IN_PROGRESS（处理中，会进入AI流程）
      const initialStatus = requiresDirectTransfer ? 'WAITING' : 'IN_PROGRESS';

      // 先创建工单（不设置 priorityScore，稍后计算）
      let ticket;
      try {
        ticket = await this.prisma.ticket.create({
          data: {
            ...otherData,
            serverId,
            serverName,
            ticketNo,
            token,
            status: initialStatus,
            identityStatus: 'NOT_VERIFIED',
            priority: 'NORMAL', // 临时设置，稍后更新
            priorityScore: 50, // 临时设置，稍后更新
            occurredAt: occurredAt ? new Date(occurredAt) : null,
            ticketIssueTypes: {
              create:
                issueTypeIds?.map((issueTypeId) => ({
                  issueTypeId,
                })) || [],
            },
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`创建工单失败: ${errorMessage}`, errorStack, {
          gameId: createTicketDto.gameId,
          playerIdOrName: createTicketDto.playerIdOrName,
          description: createTicketDto.description?.substring(0, 50),
          issueTypeIds,
          serverId,
          serverName,
        });
        throw new Error(`创建工单失败: ${errorMessage}`);
      }

      // 计算优先级（基于问题类型权重）
      try {
        const { priorityScore, priority } =
          await this.priorityService.calculatePriority(issueTypeIds || []);

        // 更新工单的优先级和分数
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            priority,
            priorityScore,
          },
        });
      } catch (error) {
        // 如果计算优先级失败，使用默认值，不影响工单创建
        this.logger.error('计算优先级失败，使用默认值:', error);
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            priority: 'NORMAL',
            priorityScore: 50,
          },
        });
      }

      // 如果需要直接转人工，检查是否有在线客服
      let hasOnlineAgents = false;
      let sessionCreated = false;
      let sessionId: string | null = null;
      if (requiresDirectTransfer) {
        // 检查是否有在线客服（包括管理员）
        const onlineAgentsCount = await this.prisma.user.count({
          where: {
            role: { in: ['AGENT', 'ADMIN'] },
            isOnline: true,
            deletedAt: null,
          },
        });
        hasOnlineAgents = onlineAgentsCount > 0;
      }

      // 异步验证身份（如果有订单号）
      if (createTicketDto.paymentOrderNo) {
        this.verifyPaymentIdentity(
          ticket.id,
          createTicketDto.playerIdOrName,
          createTicketDto.paymentOrderNo,
        ).catch((error) => {
          this.logger.error('身份验证失败:', error);
        });
      }

      // 关键业务日志：工单创建
      this.logger.logBusiness({
        action: 'ticket_created',
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        gameId: createTicketDto.gameId,
        status: initialStatus,
        requiresDirectTransfer,
        sessionCreated,
      });

      return {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        token: ticket.token,
        hasOnlineAgents: requiresDirectTransfer ? hasOnlineAgents : undefined,
        sessionCreated: requiresDirectTransfer ? sessionCreated : undefined,
        sessionId:
          requiresDirectTransfer && sessionCreated && sessionId
            ? sessionId
            : undefined,
      };
    } catch (error: unknown) {
      // 捕获所有未处理的错误
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`创建工单过程中发生错误: ${errorMsg}`, errorStack);
      throw error; // 重新抛出，让 NestJS 的异常过滤器处理
    }
  }

  // 验证支付身份
  private async verifyPaymentIdentity(
    ticketId: string,
    playerIdOrName: string,
    paymentOrderNo: string,
  ) {
    // TODO: 调用支付网关API验证
    // 这里先模拟验证逻辑
    const isValid = true; // 实际应该调用支付网关API

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        identityStatus: isValid ? 'VERIFIED_PAYMENT' : 'NOT_VERIFIED',
      },
    });
  }

  // 根据工单ID发送工单消息（管理端）
  async sendMessageByTicketId(
    ticketId: string,
    senderId: string,
    content: string,
  ) {
    return this.ticketMessageService.create(ticketId, senderId, content);
  }

  // 根据token发送工单消息（玩家端）
  async sendMessageByToken(token: string, content: string) {
    const ticket = await this.findByToken(token);

    // 玩家发送消息时，senderId 为 null（表示玩家）
    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: null, // 玩家消息，没有 senderId
        content,
      },
    });

    // 更新工单状态为等待回复
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'WAITING',
      },
    });

    // 获取完整消息信息（包含 sender）
    const messageWithSender = await this.prisma.ticketMessage.findUnique({
      where: { id: message.id },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    // 通过 WebSocket 通知工单消息（通知玩家端）
    if (messageWithSender) {
      this.websocketGateway.notifyTicketMessage(ticket.id, messageWithSender);
    }

    // 如果工单关联了会话，同时创建会话消息并发送到会话房间（客服端可以接收）
    const session = await this.prisma.session.findFirst({
      where: {
        ticketId: ticket.id,
        status: { in: ['QUEUED', 'IN_PROGRESS'] },
      },
    });

    if (session) {
      try {
        // 创建会话消息（玩家消息）
        const sessionMessage = await this.prisma.message.create({
          data: {
            sessionId: session.id,
            senderType: 'PLAYER',
            senderId: null,
            content: messageWithSender?.content || message.content,
            messageType: 'TEXT',
          },
        });

        // 发送到会话房间（格式：{ sessionId, message }）
        this.websocketGateway.notifyMessage(session.id, sessionMessage);
      } catch (sessionError) {
        // 会话消息创建失败不影响工单消息
        const errorMsg = sessionError instanceof Error ? sessionError.message : String(sessionError);
        this.logger.warn(`创建会话消息失败: ${errorMsg}`);
      }
    }

    return messageWithSender || message;
  }

  // 通过 ticketService 调用 sessionService 的方法（用于解决循环依赖）
  async closeSessionByPlayer(sessionId: string) {
    return this.sessionService.closeByPlayer(sessionId);
  }
}
