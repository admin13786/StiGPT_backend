import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Inject,
  OnModuleInit,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MessageService } from '../message/message.service';
import { TicketService } from '../ticket/ticket.service';
import { forwardRef } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import {
  wsConnectionsGauge,
  wsMessagesCounter,
} from '../metrics/queue.metrics';
import { AppLogger } from '../common/logger/app-logger.service';

const defaultSocketOrigins = [
  'http://localhost:32111',
  'http://localhost:32112',
  'http://127.0.0.1:32111',
  'http://127.0.0.1:32112',
  'http://localhost:20101',
  'http://localhost:20102',
  'http://127.0.0.1:20101',
  'http://127.0.0.1:20102',
];

const parseSocketOrigins = (value?: string): string[] =>
  value
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean) ?? [];

@WebSocketGateway({
  cors: {
    origin:
      parseSocketOrigins(process.env.FRONTEND_URL).length > 0
        ? parseSocketOrigins(process.env.FRONTEND_URL)
        : parseSocketOrigins(process.env.CORS_DEFAULT_DEV_ORIGINS).length > 0
          ? parseSocketOrigins(process.env.CORS_DEFAULT_DEV_ORIGINS)
          : defaultSocketOrigins,
    credentials: true,
  },
  namespace: '/',
})
export class WebsocketGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnApplicationBootstrap
{
  @WebSocketServer()
  server: Server;

  // 内存缓存（提高性能）
  private connectedClients = new Map<
    string,
    {
      userId?: string;
      role?: string;
      username?: string;
      realName?: string;
      sessionId?: string;
      clientType?: 'player' | 'agent';
    }
  >();
  private playerSessions = new Map<string, string>(); // clientId -> sessionId

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private messageService: MessageService,
    @Inject(forwardRef(() => TicketService))
    private ticketService: TicketService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(WebsocketGateway.name);
  }

  async onModuleInit() {
    // 初始化阶段不再延迟，实际恢复放在 onApplicationBootstrap
  }

  async onApplicationBootstrap() {
    // 设置心跳服务的 Server 引用（用于通知客服）
    // this.heartbeatService.setServer(this.server);

    // this.stateService.restoreStateFromRedis().catch((err) => {
    //   this.logger.error('WebSocket 状态恢复过程中发生未捕获异常', err);
    // });
    this.logger.log('WebSocket Gateway 已启动');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (token) {
        try {
          const payload = this.jwtService.verify(token, {
            secret: this.configService.get<string>('JWT_SECRET'),
          });

          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });

          if (user && !user.deletedAt) {
            const clientInfo = {
              userId: user.id,
              role: user.role,
              username: user.username,
              realName: user.realName || undefined,
            };

            // 保存到内存
            this.connectedClients.set(client.id, clientInfo);
            // await this.stateService.saveClient(client.id, clientInfo);

            // 更新用户在线状态（客服和管理员）
            if (user.role === 'AGENT' || user.role === 'ADMIN') {
              await this.prisma.user.update({
                where: { id: user.id },
                data: { isOnline: true },
              });

              // await this.stateService.saveAgentOnline(user.id, {
              //   username: user.username,
              //   realName: user.realName || undefined,
              //   avatar: user.avatar || undefined,
              // });

              this.notifyAgentStatusChange(user.id, true, {
                username: user.username,
                realName: user.realName || undefined,
                avatar: user.avatar || undefined,
              });

              // 客服或管理员上线时，自动分配 WAITING 状态的工单
              this.ticketService
                .autoAssignWaitingTickets(user.id)
                .catch((error) => {
                  this.logger.error(
                    `自动分配工单失败: ${error.message}`,
                    error instanceof Error ? error.stack : undefined,
                    { userId: user.id },
                  );
                });
            }

            this.logger.log(`用户连接: ${user.username} (${client.id})`);
          }
        } catch (error) {
          this.logger.warn(`Token验证失败: ${client.id}`);
        }
      } else {
        // 玩家端连接（无token）
        const clientInfo = {};
        this.connectedClients.set(client.id, clientInfo);
        // await this.stateService.saveClient(client.id, clientInfo);

        this.logger.log(`玩家连接: ${client.id}`);

        // 设置心跳检测
        // this.heartbeatService.setupHeartbeat(client);
      }
    } catch (error) {
      this.logger.error(
        `连接处理错误: ${error.message}`,
        error instanceof Error ? error.stack : undefined,
        { clientId: client.id },
      );
    }
  }

  async handleDisconnect(client: Socket) {
    const clientInfo = this.connectedClients.get(client.id);

    // 记录 WebSocket 断开连接指标
    if (clientInfo?.clientType) {
      wsConnectionsGauge.dec({ client_type: clientInfo.clientType });
    }

    // 清除心跳检测和限流状态
    // this.heartbeatService.clearHeartbeat(client.id);
    // this.rateLimitService.clearClient(client.id);

    // 从 Redis 删除客户端信息
    // await this.stateService.deleteClient(client.id);

    if (clientInfo?.userId) {
      const user = await this.prisma.user
        .findUnique({
          where: { id: clientInfo.userId },
          select: { role: true },
        })
        .catch(() => null);

      await this.prisma.user
        .update({
          where: { id: clientInfo.userId },
          data: { isOnline: false },
        })
        .catch(() => {});

      if (user?.role === 'AGENT') {
        // await this.stateService.deleteAgentOnline(clientInfo.userId);

        this.notifyAgentStatusChange(clientInfo.userId, false, {
          username: clientInfo.username,
          realName: clientInfo.realName,
        });
      }
    } else {
      // 玩家端断开连接
      const sessionId = this.playerSessions.get(client.id);
      if (sessionId) {
        this.logger.log(
          `玩家断开连接，会话 ${sessionId} 保持在队列中，等待客服处理`,
        );
        this.playerSessions.delete(client.id);
        // await this.stateService.deletePlayerSession(client.id);
      }
    }

    this.connectedClients.delete(client.id);
    this.logger.log(`客户端断开: ${client.id}`);
  }

  // ==================== 玩家端消息处理 ====================

  @SubscribeMessage('send-message')
  async handlePlayerMessage(
    @MessageBody() data: { sessionId: string; content: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo && !clientInfo.clientType) {
        clientInfo.clientType = 'player';
        wsConnectionsGauge.inc({ client_type: 'player' });
      }

      // Rate limiting disabled
      // if (!this.rateLimitService || !this.rateLimitService.allowMessage(client.id, 'player')) {
      //   this.rateLimitService.handleRateLimit(
      //     client,
      //     'send-message',
      //     'player',
      //     clientInfo,
      //   );
      //   return { success: false, error: 'rate_limited' };
      // }

      wsMessagesCounter.inc({ direction: 'in' });

      const message = await this.messageService.create(
        {
          sessionId: data.sessionId,
          content: data.content,
          messageType: MessageType.TEXT,
        },
        'PLAYER',
      );

      this.notifyMessage(data.sessionId, message);

      return { success: true, messageId: message.id };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `发送消息失败: ${errorMsg}`,
        errorStack,
        {
          sessionId: data.sessionId,
          content: data.content?.substring(0, 50),
        },
      );
      return { success: false, error: errorMsg };
    }
  }

  // ==================== 客服端消息处理 ====================

  @SubscribeMessage('agent:send-message')
  async handleAgentMessage(
    @MessageBody()
    data: { sessionId: string; content: string; messageType?: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const clientInfo = this.connectedClients.get(client.id);
      if (clientInfo && !clientInfo.clientType) {
        clientInfo.clientType = 'agent';
        wsConnectionsGauge.inc({ client_type: 'agent' });
      }

      // Rate limiting disabled
      // if (!this.rateLimitService || !this.rateLimitService.allowMessage(client.id, 'agent')) {
      //   this.rateLimitService.handleRateLimit(
      //     client,
      //     'agent:send-message',
      //     'agent',
      //     clientInfo,
      //   );
      //   return { success: false, error: 'rate_limited' };
      // }

      if (!clientInfo?.userId) {
        return { success: false, error: '未认证' };
      }

      wsMessagesCounter.inc({ direction: 'in' });

      const session = await this.prisma.session.findUnique({
        where: { id: data.sessionId },
        include: { ticket: true },
      });

      if (!session) {
        return { success: false, error: '会话不存在' };
      }

      const user = await this.prisma.user.findUnique({
        where: { id: clientInfo.userId },
        select: { role: true },
      });

      if (user?.role === 'AGENT') {
        if (session.agentId !== clientInfo.userId) {
          return {
            success: false,
            error: '无权发送消息：该会话已分配给其他客服',
          };
        }
        if (session.status !== 'IN_PROGRESS') {
          return {
            success: false,
            error: '会话未接入，请先接入会话后才能发送消息',
          };
        }
      }

      const message = await this.messageService.create(
        {
          sessionId: data.sessionId,
          content: data.content,
          messageType: (data.messageType as any) || 'TEXT',
        },
        'AGENT',
        clientInfo.userId,
        user ? { id: clientInfo.userId, role: user.role } : undefined,
      );

      this.notifyMessage(data.sessionId, message);

      // 如果会话关联了工单，同时创建工单消息
      if (session.ticketId && session.ticket) {
        try {
          const ticketMessage = await this.prisma.ticketMessage.create({
            data: {
              ticketId: session.ticketId,
              senderId: clientInfo.userId,
              content: data.content,
            },
            include: {
              sender: {
                select: { id: true, username: true, realName: true },
              },
            },
          });

          this.notifyTicketMessage(session.ticketId, ticketMessage);

          await this.prisma.ticket.update({
            where: { id: session.ticketId },
            data: { status: 'IN_PROGRESS' },
          });

          this.notifyTicketUpdate(session.ticketId, { status: 'IN_PROGRESS' });
        } catch (ticketError: unknown) {
          const errorMsg = ticketError instanceof Error ? ticketError.message : String(ticketError);
          this.logger.warn(`创建工单消息失败: ${errorMsg}`);
        }
      }

      return { success: true, messageId: message.id };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `客服发送消息失败: ${errorMsg}`,
        errorStack,
        {
          sessionId: data.sessionId,
          content: data.content?.substring(0, 50),
        },
      );
      return { success: false, error: errorMsg };
    }
  }

  // ==================== 会话/房间管理 ====================

  @SubscribeMessage('join-session')
  async handleJoinSession(
    @MessageBody() data: { sessionId: string; isReconnect?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`session:${data.sessionId}`);

    const clientInfo = this.connectedClients.get(client.id);
    if (!clientInfo?.userId) {
      // 玩家端加入会话
      const previousSessionId = this.playerSessions.get(client.id);
      const isReconnect = data.isReconnect || previousSessionId === data.sessionId;

      this.playerSessions.set(client.id, data.sessionId);
      // await this.stateService.savePlayerSession(client.id, data.sessionId);

      // 更新心跳服务的 sessionId
      // this.heartbeatService.updateSessionId(client.id, data.sessionId);

      const existingInfo = this.connectedClients.get(client.id);
      if (existingInfo) {
        existingInfo.sessionId = data.sessionId;
        // await this.stateService.saveClient(client.id, existingInfo);
      }

      // 如果是重连，通知客服玩家已重新连接
      if (isReconnect) {
        // this.heartbeatService.notifyAgentPlayerReconnected(
        //   data.sessionId,
        //   client.id,
        // );
        this.logger.log(`玩家重新连接会话: ${data.sessionId}`);
      } else {
        this.logger.log(`玩家加入会话: ${data.sessionId}`);
      }
    } else {
      // 客服/管理员加入会话
      this.logger.log(`客服加入会话: ${data.sessionId}`);
    }

    return { success: true };
  }

  @SubscribeMessage('leave-session')
  async handleLeaveSession(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`session:${data.sessionId}`);
    this.logger.log(`客户端离开会话: ${data.sessionId}`);
    return { success: true };
  }

  @SubscribeMessage('join-ticket')
  async handleJoinTicket(
    @MessageBody() data: { ticketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`ticket:${data.ticketId}`);
    this.logger.log(`客户端加入工单: ${data.ticketId}`);
    return { success: true };
  }

  @SubscribeMessage('leave-ticket')
  async handleLeaveTicket(
    @MessageBody() data: { ticketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`ticket:${data.ticketId}`);
    this.logger.log(`客户端离开工单: ${data.ticketId}`);
    return { success: true };
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    // return this.heartbeatService.handlePing(client);
    return { success: true, timestamp: Date.now() };
  }

  // ==================== 通知方法 ====================

  notifySessionUpdate(sessionId: string, data: any) {
    this.server.to(`session:${sessionId}`).emit('session-update', data);
    this.logger.debug(`通知会话更新: ${sessionId}, 状态: ${data.status}`);
  }

  notifyNewSession(session: any) {
    this.server.emit('new-session', session);
  }

  notifyQueueUpdate(
    sessionId: string,
    position: number,
    waitTime?: number | null,
  ) {
    this.server.to(`session:${sessionId}`).emit('queue-update', {
      queuePosition: position,
      position,
      waitTime,
      estimatedWaitTime: waitTime,
    });
  }

  notifyMessage(sessionId: string, message: any) {
    wsMessagesCounter.inc({ direction: 'out' });
    this.server.to(`session:${sessionId}`).emit('message', {
      sessionId,
      message,
    });
  }

  notifyAgentStatusChange(
    agentId: string,
    isOnline: boolean,
    extra?: { username?: string; realName?: string; avatar?: string },
  ) {
    this.server.emit('agent-status-changed', {
      agentId,
      isOnline,
      username: extra?.username,
      realName: extra?.realName,
      avatar: extra?.avatar,
    });
  }

  notifyTicketMessage(ticketId: string, message: any) {
    this.server.to(`ticket:${ticketId}`).emit('ticket-message', message);
  }

  notifyTicketUpdate(ticketId: string, data: any) {
    this.server.to(`ticket:${ticketId}`).emit('ticket-update', data);
    this.server.emit('ticket-status-changed', { ticketId, ...data });
  }
}
