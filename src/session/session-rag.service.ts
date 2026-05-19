import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { MessageService } from '../message/message.service';
import { Inject, forwardRef } from '@nestjs/common';
import { MessageType } from '@prisma/client';

/**
 * Session RAG Service
 * 处理会话中的 RAG 查询功能
 */
@Injectable()
export class SessionRagService {
  private readonly logger = new Logger(SessionRagService.name);

  constructor(
    private prisma: PrismaService,
    private ragService: RagService,
    private messageService: MessageService,
    @Inject(forwardRef(() => WebsocketGateway))
    private websocketGateway: WebsocketGateway,
  ) {}

  /**
   * 启用会话的 RAG 功能
   */
  async enableRag(sessionId: string, kbId: string, personaId?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // 更新会话，启用 RAG
    const updatedSession = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        kbId,
        personaId: personaId || null,
        ragEnabled: true,
      },
      include: {
        ticket: true,
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    this.logger.log(`RAG enabled for session ${sessionId} with kb ${kbId}`);

    // 通知前端
    this.websocketGateway.notifySessionUpdate(sessionId, updatedSession);

    return updatedSession;
  }

  /**
   * 禁用会话的 RAG 功能
   */
  async disableRag(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    const updatedSession = await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        ragEnabled: false,
      },
      include: {
        ticket: true,
        agent: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    this.logger.log(`RAG disabled for session ${sessionId}`);

    // 通知前端
    this.websocketGateway.notifySessionUpdate(sessionId, updatedSession);

    return updatedSession;
  }

  /**
   * 处理 RAG 查询（在会话上下文中）
   */
  async handleRagQuery(sessionId: string, query: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        ticket: true,
      },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    if (!session.ragEnabled || !session.kbId) {
      throw new Error('该会话未启用 RAG 功能');
    }

    // 保存用户消息
    const userMessage = await this.messageService.create(
      {
        sessionId,
        content: query,
        messageType: MessageType.TEXT,
      },
      'PLAYER',
    );

    // 通知前端用户消息
    this.websocketGateway.notifyMessage(sessionId, userMessage);

    try {
      // 调用 RAG 服务
      const ragResponse = await this.ragService.query(
        {
          query,
          kbId: session.kbId,
          sessionId,
          topK: 5,
          temperature: 0.7,
        },
        userId,
      );

      // 保存 AI 回复消息
      const aiMessage = await this.messageService.create(
        {
          sessionId,
          content: ragResponse.answer,
          messageType: MessageType.TEXT,
          metadata: {
            ragResponse: {
              citations: ragResponse.citations,
              retrievedCount: ragResponse.retrievedCount,
              tokenUsage: ragResponse.tokenUsage,
              processingTime: ragResponse.processingTime,
            },
          },
        },
        'AI',
      );

      // 通知前端 AI 消息
      this.websocketGateway.notifyMessage(sessionId, aiMessage);

      return {
        userMessage,
        aiMessage,
        ragResponse,
      };
    } catch (error) {
      this.logger.error(`RAG query failed for session ${sessionId}`, error);

      // 发送错误消息
      const errorMessage = await this.messageService.createSystemMessage(
        sessionId,
        '抱歉，处理您的问题时出现了错误，请稍后重试。',
      );

      this.websocketGateway.notifyMessage(sessionId, errorMessage);

      throw error;
    }
  }

  /**
   * 流式 RAG 查询
   */
  async *handleRagQueryStream(sessionId: string, query: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    if (!session.ragEnabled || !session.kbId) {
      throw new Error('该会话未启用 RAG 功能');
    }

    // 保存用户消息
    const userMessage = await this.messageService.create(
      {
        sessionId,
        content: query,
        messageType: MessageType.TEXT,
      },
      'PLAYER',
    );

    this.websocketGateway.notifyMessage(sessionId, userMessage);

    // 流式返回 RAG 响应
    for await (const chunk of this.ragService.queryStream(
      {
        query,
        kbId: session.kbId,
        sessionId,
        topK: 5,
        temperature: 0.7,
        stream: true,
      },
      userId,
    )) {
      yield chunk;
    }
  }

  /**
   * 获取会话的 RAG 配置
   */
  async getRagConfig(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        ragEnabled: true,
        kbId: true,
        personaId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    return session;
  }
}
