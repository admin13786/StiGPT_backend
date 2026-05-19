import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService, type LlmMessage } from '../rag/llm.service';
import {
  RetrievalService,
  type RetrievalResult,
} from '../rag/retrieval.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  getRouteModeDefinition as getStigptRouteModeDefinition,
  getRouteModeDefinitions as getStigptRouteModeDefinitions,
  getRouteSurfaceDefinition as getStigptRouteSurfaceDefinition,
  getRouteSurfaceDefinitions as getStigptRouteSurfaceDefinitions,
  normalizeRouteKey as normalizeStigptRouteKey,
  ROUTE_MODE_KEYS,
  type RouteModeDefinition,
  type StigptRouteModeKey,
} from './stigpt-chat.definitions';

type StigptConversationRecord = Prisma.StigptConversationGetPayload<{
  include: { model: true };
}>;
type StigptModelRecord = Prisma.StigptChatModelGetPayload<object>;
type KnowledgeBaseRecord = Prisma.KnowledgeBaseGetPayload<object>;

interface ConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface StigptCitation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  chunkIndex: number;
}

interface StigptTokenUsage {
  prompt: number;
  completion: number;
  total: number;
  streamed?: boolean;
}

interface PreparedConversationTurn {
  conversationId: string;
  conversationTitle: string;
  routeKey: string;
  routeMode: StigptRouteModeKey;
  routeModeDefinition: RouteModeDefinition;
  content: string;
  history: ConversationHistoryItem[];
  model: StigptModelRecord | null;
  kbId?: string;
  userMessageId: string;
  assistantMessageId: string;
}

interface GenerateTurnOptions {
  onCitations?: (citations: StigptCitation[]) => Promise<void> | void;
  onDelta?: (delta: string) => Promise<void> | void;
}

interface GeneratedTurnResult {
  content: string;
  citations: StigptCitation[];
  tokenUsage: StigptTokenUsage;
  degraded: boolean;
  errorMessage?: string;
}

export interface StigptKnowledgeBaseOption {
  id: string;
  name: string;
  description: string | null;
  aclScope: string;
  documentCount: number;
  chunkCount: number;
  updatedAt: Date;
  recommended: boolean;
  recommendationScore: number;
  recommendationReason: string;
}

const EMPTY_TOKEN_USAGE: StigptTokenUsage = {
  prompt: 0,
  completion: 0,
  total: 0,
};

@Injectable()
export class StigptChatService {
  private readonly logger = new Logger(StigptChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async getPageConfig(routeKey = 'webIdx') {
    await this.ensureBootstrapData();
    const normalizedRouteKey = this.normalizeRouteKey(routeKey);

    return this.prisma.stigptPageConfig.findFirst({
      where: { routeKey: normalizedRouteKey, isActive: true },
    });
  }

  async getModels(routeKey = 'webIdx') {
    await this.ensureBootstrapData();
    const normalizedRouteKey = this.normalizeRouteKey(routeKey);

    return this.prisma.stigptChatModel.findMany({
      where: {
        isActive: true,
        supportedRoutes: { has: normalizedRouteKey },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getExamples(routeKey = 'webIdx', modelId?: string) {
    await this.ensureBootstrapData();
    const normalizedRouteKey = this.normalizeRouteKey(routeKey);

    return this.prisma.stigptExample.findMany({
      where: {
        routeKey: normalizedRouteKey,
        isActive: true,
        ...(modelId
          ? {
              OR: [{ modelId }, { modelId: null }],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getKnowledgeBases(
    userId: string,
    routeKey = 'webIdx',
    requestedRouteMode?: string,
  ): Promise<StigptKnowledgeBaseOption[]> {
    await this.ensureBootstrapData();
    const normalizedRouteKey = this.normalizeRouteKey(routeKey);
    const routeMode = this.resolveRouteMode(
      requestedRouteMode,
      undefined,
      normalizedRouteKey,
    );
    const knowledgeBases = await this.findAccessibleKnowledgeBases(userId);
    const recommendedKnowledgeBase = this.selectRecommendedKnowledgeBase(
      knowledgeBases,
      routeMode,
    );
    const routeModeDefinition = this.getRouteModeDefinition(routeMode);

    return knowledgeBases
      .map((knowledgeBase) => {
        const recommendationScore = this.scoreKnowledgeBase(
          knowledgeBase,
          routeModeDefinition.knowledgeHints,
        );

        return {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          description: knowledgeBase.description,
          aclScope: knowledgeBase.aclScope,
          documentCount: knowledgeBase.documentCount,
          chunkCount: knowledgeBase.chunkCount,
          updatedAt: knowledgeBase.updatedAt,
          recommended: knowledgeBase.id === recommendedKnowledgeBase?.id,
          recommendationScore: Number(recommendationScore.toFixed(2)),
          recommendationReason: this.buildKnowledgeBaseRecommendationReason(
            knowledgeBase,
            routeMode,
            routeModeDefinition.knowledgeHints,
            recommendationScore,
          ),
        };
      })
      .sort((left, right) => {
        if (left.recommended !== right.recommended) {
          return left.recommended ? -1 : 1;
        }

        if (left.recommendationScore !== right.recommendationScore) {
          return right.recommendationScore - left.recommendationScore;
        }

        if (left.documentCount !== right.documentCount) {
          return right.documentCount - left.documentCount;
        }

        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      })
      .slice(0, 12);
  }

  async listConversations(userId: string, routeKey = 'webIdx') {
    await this.ensureBootstrapData();
    const normalizedRouteKey = this.normalizeRouteKey(routeKey);

    return this.prisma.stigptConversation.findMany({
      where: {
        userId,
        routeKey: normalizedRouteKey,
      },
      include: {
        model: {
          select: {
            id: true,
            code: true,
            name: true,
            provider: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async createConversation(userId: string, dto: CreateConversationDto) {
    await this.ensureBootstrapData();

    const routeKey = this.normalizeRouteKey(dto.routeKey);
    const routeMode = this.resolveRouteMode(dto.routeMode, undefined, routeKey);
    const routeModeDefinition = this.getRouteModeDefinition(routeMode);
    const model = await this.resolveModel(routeKey, dto.modelId);

    return this.prisma.stigptConversation.create({
      data: {
        userId,
        routeKey,
        title: dto.title?.trim() || 'New conversation',
        modelId: model?.id,
        personaId: dto.personaId,
        kbId: dto.kbId,
        metadata: {
          source: 'manual-create',
          routeMode,
          routeLabel: routeModeDefinition.label,
          modelId: model?.id ?? null,
          kbId: dto.kbId ?? null,
        } satisfies Prisma.InputJsonValue,
      },
      include: {
        model: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getConversation(userId: string, conversationId: string) {
    await this.ensureBootstrapData();

    const conversation = await this.prisma.stigptConversation.findUnique({
      where: { id: conversationId },
      include: {
        model: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException(
        'Conversation does not belong to current user',
      );
    }

    return conversation;
  }

  async createMessage(
    userId: string,
    conversationId: string,
    dto: CreateMessageDto,
  ) {
    const turn = await this.prepareConversationTurn(userId, conversationId, dto);
    const result = await this.generateTurnReply(turn);
    await this.finalizeAssistantMessage(turn, result);
    return this.getConversation(userId, conversationId);
  }

  async streamMessage(
    userId: string,
    conversationId: string,
    dto: CreateMessageDto,
    response: Response,
  ) {
    let sseOpened = false;

    try {
      const turn = await this.prepareConversationTurn(userId, conversationId, dto);
      this.openSse(response);
      sseOpened = true;

      this.writeSse(response, 'meta', {
        conversationId: turn.conversationId,
        conversationTitle: turn.conversationTitle,
        routeKey: turn.routeKey,
        routeMode: turn.routeMode,
        routeLabel: turn.routeModeDefinition.label,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
        modelId: turn.model?.id ?? null,
        modelName: turn.model?.name ?? null,
        kbId: turn.kbId ?? null,
      });

      const result = await this.generateTurnReply(turn, {
        onCitations: async (citations) => {
          this.writeSse(response, 'citations', {
            assistantMessageId: turn.assistantMessageId,
            citations,
          });
        },
        onDelta: async (delta) => {
          this.writeSse(response, 'delta', {
            assistantMessageId: turn.assistantMessageId,
            delta,
          });
        },
      });

      await this.finalizeAssistantMessage(turn, result);

      this.writeSse(response, 'done', {
        conversationId: turn.conversationId,
        assistantMessageId: turn.assistantMessageId,
        routeMode: turn.routeMode,
        tokenUsage: result.tokenUsage,
        degraded: result.degraded,
      });
    } catch (error) {
      if (!sseOpened) {
        const status = this.getHttpStatus(error);
        response.status(status).json({
          success: false,
          message: this.getClientFacingMessage(error),
        });
        return;
      }

      this.writeSse(response, 'error', {
        message: this.getClientFacingMessage(error),
      });
    } finally {
      if (!response.writableEnded) {
        response.end();
      }
    }
  }

  private async prepareConversationTurn(
    userId: string,
    conversationId: string,
    dto: CreateMessageDto,
  ): Promise<PreparedConversationTurn> {
    await this.ensureBootstrapData();

    const conversation = await this.getOwnedConversation(userId, conversationId);
    const content = dto.content.trim();

    if (!content) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const history = await this.loadConversationHistory(conversationId);
    const routeMode = this.resolveRouteMode(
      dto.routeMode,
      conversation.metadata,
      conversation.routeKey,
    );
    const routeModeDefinition = this.getRouteModeDefinition(routeMode);
    const model = await this.resolveModel(
      conversation.routeKey,
      dto.modelId,
      conversation.modelId ?? undefined,
    );
    const kbId = await this.resolveKnowledgeBaseId(
      userId,
      dto.kbId,
      conversation.kbId ?? undefined,
      routeMode,
    );
    const nextTitle =
      conversation.title === 'New conversation'
        ? this.buildConversationTitle(content)
        : conversation.title;
    const baseMetadata = {
      routeMode,
      routeLabel: routeModeDefinition.label,
      modelId: model?.id ?? null,
      kbId: kbId ?? null,
    };

    const prepared = await this.prisma.$transaction(async (tx) => {
      const userMessage = await tx.stigptMessage.create({
        data: {
          conversationId,
          role: 'user',
          content,
          status: 'completed',
          metadata: {
            ...(dto.metadata || {}),
            ...baseMetadata,
            source: 'stigpt-user',
          } satisfies Prisma.InputJsonValue,
        },
      });

      const assistantMessage = await tx.stigptMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          metadata: {
            ...baseMetadata,
            source: 'stigpt-chat',
            streamMode: 'sse',
          } satisfies Prisma.InputJsonValue,
        },
      });

      await tx.stigptConversation.update({
        where: { id: conversationId },
        data: {
          title: nextTitle,
          lastMessageAt: new Date(),
          modelId: model?.id,
          kbId: kbId ?? conversation.kbId,
          metadata: {
            ...this.asJsonObject(conversation.metadata),
            ...baseMetadata,
            source: 'chat-turn',
          } satisfies Prisma.InputJsonValue,
        },
      });

      return {
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
      };
    });

    return {
      conversationId,
      conversationTitle: nextTitle,
      routeKey: conversation.routeKey,
      routeMode,
      routeModeDefinition,
      content,
      history,
      model,
      kbId,
      userMessageId: prepared.userMessageId,
      assistantMessageId: prepared.assistantMessageId,
    };
  }

  private async generateTurnReply(
    turn: PreparedConversationTurn,
    options?: GenerateTurnOptions,
  ): Promise<GeneratedTurnResult> {
    const citations = await this.retrieveCitations(turn);
    const messages = this.buildLlmMessages(turn, citations);

    if (options?.onCitations) {
      await options.onCitations(citations);
    }

    let content = '';
    let degraded = false;
    let errorMessage: string | undefined;
    let tokenUsage: StigptTokenUsage = options?.onDelta
      ? { ...EMPTY_TOKEN_USAGE, streamed: true }
      : { ...EMPTY_TOKEN_USAGE };

    try {
      if (options?.onDelta) {
        for await (const rawChunk of this.llmService.generateStream(messages, 0.4)) {
          const delta = this.normalizeStreamDelta(rawChunk, content);
          if (!delta) {
            continue;
          }
          content += delta;
          await options.onDelta(delta);
        }
      } else {
        const response = await this.llmService.generate(messages, 0.4);
        content = response.answer.trim();
        tokenUsage = response.tokenUsage;
      }
    } catch (error) {
      degraded = true;
      const diagnosticMessage = this.getErrorMessage(error);
      errorMessage = this.getGenerationFallbackNotice(error);
      this.logger.warn(
        `STIGPT generation degraded for ${turn.routeMode}: ${diagnosticMessage}`,
      );

      if (content.trim()) {
        const suffix =
          '\n\n系统提示：实时生成中断，以下为已生成的可用内容。';
        content += suffix;
        if (options?.onDelta) {
          await options.onDelta(suffix);
        }
      }
    }

    if (!content.trim()) {
      degraded = true;
      content = this.buildStructuredFallbackReply(turn, citations, errorMessage);
      if (options?.onDelta) {
        await options.onDelta(content);
      }
    }

    return {
      content: content.trim(),
      citations,
      tokenUsage,
      degraded,
      errorMessage,
    };
  }

  private async finalizeAssistantMessage(
    turn: PreparedConversationTurn,
    result: GeneratedTurnResult,
  ) {
    await this.prisma.stigptMessage.update({
      where: { id: turn.assistantMessageId },
      data: {
        content: result.content,
        status: 'completed',
        citations: result.citations as unknown as Prisma.InputJsonValue,
        tokenUsage: result.tokenUsage as unknown as Prisma.InputJsonValue,
        metadata: {
          routeMode: turn.routeMode,
          routeLabel: turn.routeModeDefinition.label,
          modelId: turn.model?.id ?? null,
          kbId: turn.kbId ?? null,
          source: 'stigpt-chat',
          hasCitations: result.citations.length > 0,
          degraded: result.degraded,
          errorMessage: result.errorMessage ?? null,
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  private async getOwnedConversation(
    userId: string,
    conversationId: string,
  ): Promise<StigptConversationRecord> {
    const conversation = await this.prisma.stigptConversation.findUnique({
      where: { id: conversationId },
      include: { model: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException(
        'Conversation does not belong to current user',
      );
    }

    return conversation;
  }

  private async loadConversationHistory(
    conversationId: string,
    limit = 8,
  ): Promise<ConversationHistoryItem[]> {
    const messages = await this.prisma.stigptMessage.findMany({
      where: {
        conversationId,
        content: { not: '' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages
      .reverse()
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));
  }

  private buildLlmMessages(
    turn: PreparedConversationTurn,
    citations: StigptCitation[],
  ): LlmMessage[] {
    const systemParts = [
      `你是 ${turn.routeModeDefinition.assistantName}，当前工作模式是「${turn.routeModeDefinition.label}」。`,
      turn.routeModeDefinition.systemPrompt,
      citations.length > 0
        ? `当前检索到的参考资料如下，请优先基于这些资料作答，并在引用事实时使用 [1] [2] 这样的编号：\n\n${citations
            .map(
              (citation, index) =>
                `[${index + 1}] ${citation.documentTitle}\n${citation.content}`,
            )
            .join('\n\n')}`
        : turn.kbId
          ? '当前没有检索到足够相关的知识库内容。不要编造事实；若证据不足，请明确说明，并给出通用的分析框架。'
          : '当前未绑定可用知识库。请提供结构化、可执行的通用建议，并明确区分事实结论与推断。 ',
      '统一要求：使用简体中文；先给结论，再给结构化展开；尽量直接、专业；不要虚构政策条款、项目编号、论文结论或实验数据。',
    ];

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: systemParts.join('\n\n'),
      },
    ];

    for (const historyItem of turn.history) {
      messages.push({
        role: historyItem.role,
        content: historyItem.content,
      });
    }

    messages.push({
      role: 'user',
      content: turn.content,
    });

    return messages;
  }

  private async retrieveCitations(
    turn: PreparedConversationTurn,
  ): Promise<StigptCitation[]> {
    if (!turn.kbId) {
      return [];
    }

    let retrievalResults: RetrievalResult[] = [];

    try {
      retrievalResults = await this.retrievalService.hybridSearch(
        turn.kbId,
        turn.content,
        turn.routeModeDefinition.topK,
      );
    } catch (error) {
      this.logger.warn(
        `Citation retrieval failed for kb ${turn.kbId}: ${this.getErrorMessage(error)}`,
      );
      return [];
    }

    return retrievalResults.map((result) => ({
      chunkId: result.chunkId,
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      content: result.content,
      score: result.score,
      chunkIndex: result.chunkIndex,
    }));
  }

  private async resolveModel(
    routeKey: string,
    requestedModelId?: string,
    currentModelId?: string,
  ): Promise<StigptModelRecord | null> {
    if (requestedModelId) {
      const requestedModel = await this.prisma.stigptChatModel.findFirst({
        where: {
          id: requestedModelId,
          isActive: true,
          supportedRoutes: { has: routeKey },
        },
      });

      if (requestedModel) {
        return requestedModel;
      }
    }

    if (currentModelId && currentModelId !== requestedModelId) {
      const currentModel = await this.prisma.stigptChatModel.findFirst({
        where: {
          id: currentModelId,
          isActive: true,
          supportedRoutes: { has: routeKey },
        },
      });

      if (currentModel) {
        return currentModel;
      }
    }

    return this.prisma.stigptChatModel.findFirst({
      where: {
        isActive: true,
        supportedRoutes: { has: routeKey },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  private async resolveKnowledgeBaseId(
    userId: string,
    requestedKbId: string | undefined,
    currentKbId: string | undefined,
    routeMode: StigptRouteModeKey,
  ) {
    if (requestedKbId && (await this.retrievalService.checkKbAccess(requestedKbId, userId))) {
      return requestedKbId;
    }

    if (currentKbId && (await this.retrievalService.checkKbAccess(currentKbId, userId))) {
      return currentKbId;
    }

    const accessibleKnowledgeBases = await this.findAccessibleKnowledgeBases(userId);
    if (accessibleKnowledgeBases.length === 0) {
      return undefined;
    }

    return this.selectRecommendedKnowledgeBase(accessibleKnowledgeBases, routeMode)?.id;
  }

  private async findAccessibleKnowledgeBases(userId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: {
        deletedAt: null,
        OR: [{ userId }, { aclScope: 'public' }, { aclScope: 'internal' }],
      },
      orderBy: [{ documentCount: 'desc' }, { updatedAt: 'desc' }],
      take: 30,
    });
  }

  private scoreKnowledgeBase(
    knowledgeBase: KnowledgeBaseRecord,
    keywords: string[],
  ) {
    const haystack = `${knowledgeBase.name} ${knowledgeBase.description ?? ''}`.toLowerCase();
    let score = Math.min(knowledgeBase.documentCount, 30) / 10;

    keywords.forEach((keyword, index) => {
      if (haystack.includes(keyword.toLowerCase())) {
        score += 12 - index;
      }
    });

    return score;
  }

  private selectRecommendedKnowledgeBase(
    knowledgeBases: KnowledgeBaseRecord[],
    routeMode: StigptRouteModeKey,
  ) {
    if (knowledgeBases.length === 0) {
      return undefined;
    }

    const hints = this.getRouteModeDefinition(routeMode).knowledgeHints;
    const scored = knowledgeBases
      .map((kb) => ({
        kb,
        score: this.scoreKnowledgeBase(kb, hints),
      }))
      .sort((left, right) => right.score - left.score);

    if (scored[0] && scored[0].score > 0) {
      return scored[0].kb;
    }

    if (routeMode === 'aiRead') {
      return knowledgeBases.find((kb) => kb.documentCount > 0);
    }

    return undefined;
  }

  private buildKnowledgeBaseRecommendationReason(
    knowledgeBase: KnowledgeBaseRecord,
    routeMode: StigptRouteModeKey,
    hints: string[],
    score: number,
  ) {
    const haystack = `${knowledgeBase.name} ${knowledgeBase.description ?? ''}`.toLowerCase();
    const matchedHints = hints.filter((keyword) =>
      haystack.includes(keyword.toLowerCase()),
    );

    if (matchedHints.length > 0) {
      return `Matched route hints: ${matchedHints.slice(0, 3).join(', ')}`;
    }

    if (routeMode === 'aiRead' && knowledgeBase.documentCount > 0) {
      return `Readable knowledge base with ${knowledgeBase.documentCount} indexed documents`;
    }

    if (score > 0) {
      return `Accessible workspace with ${knowledgeBase.documentCount} documents`;
    }

    return 'Manually selectable knowledge base';
  }

  private resolveRouteMode(
    requestedRouteMode?: string,
    metadata?: Prisma.JsonValue | null,
    routeKey = 'webIdx',
  ): StigptRouteModeKey {
    const routeSurface = this.getRouteSurfaceDefinition(routeKey);
    if (routeSurface.routeModes.length === 1) {
      return routeSurface.routeModes[0];
    }

    if (requestedRouteMode && this.isRouteModeKey(requestedRouteMode)) {
      return requestedRouteMode;
    }

    const metadataRouteMode = this.asJsonObject(metadata).routeMode;
    if (
      typeof metadataRouteMode === 'string' &&
      this.isRouteModeKey(metadataRouteMode)
    ) {
      return metadataRouteMode;
    }

    return routeSurface.defaultRouteMode;
  }

  private isRouteModeKey(value: string): value is StigptRouteModeKey {
    return ROUTE_MODE_KEYS.includes(value as StigptRouteModeKey);
  }

  private getRouteModeDefinition(routeMode: StigptRouteModeKey) {
    return getStigptRouteModeDefinition(routeMode);
  }

  private getRouteModeDefinitions(): RouteModeDefinition[] {
    return getStigptRouteModeDefinitions();
  }

  private getRouteSurfaceDefinition(routeKey?: string) {
    return getStigptRouteSurfaceDefinition(routeKey);
  }

  private normalizeRouteKey(routeKey?: string) {
    return normalizeStigptRouteKey(routeKey);
  }

  private buildFallbackReply(
    turn: PreparedConversationTurn,
    citations: StigptCitation[],
    errorMessage?: string,
  ) {
    const routeGuidance: Record<StigptRouteModeKey, string[]> = {
      policy: [
        '先确认资助对象、适用学科和申请资格。',
        '再核对时间节点、材料清单、限制性条款和评审关注点。',
        '如果需要，我可以继续把问题拆成“政策条件 / 申报动作 / 风险提醒”三栏。',
      ],
      project: [
        '先判断选题是否聚焦、创新点是否单句可说清。',
        '再检查技术路线是否闭环，是否有可验证的阶段目标。',
        '如果需要，我可以继续把你的项目思路改写成“背景-创新-路线-风险”结构。',
      ],
      aiRead: [
        '先提炼研究问题、核心方法和关键实验结论。',
        '再补充这篇文献的局限、适用边界和可借鉴之处。',
        '如果需要，我可以继续按“摘要 / 方法 / 实验 / 启发”给你做精读笔记。',
      ],
    };

    const referenceBlock =
      citations.length > 0
        ? `我已经检索到 ${citations.length} 条参考资料，优先建议查看下方引用来源。`
        : turn.kbId
          ? '当前知识库里没有检索到足够直接的证据，因此先给你一个通用分析框架。'
          : '当前没有可直接绑定的知识库，因此先给你一个通用分析框架。';

    const errorBlock = errorMessage
      ? `模型服务暂时不可用：${errorMessage}。`
      : '这次先返回一个可直接继续追问的结构化答复。';

    return [
      `已切换到「${turn.routeModeDefinition.label}」模式。`,
      referenceBlock,
      errorBlock,
      ...routeGuidance[turn.routeMode],
      `你的问题：${turn.content}`,
    ].join('\n');
  }

  private buildStructuredFallbackReply(
    turn: PreparedConversationTurn,
    citations: StigptCitation[],
    errorMessage?: string,
  ) {
    const routeGuidance: Record<
      StigptRouteModeKey,
      {
        checklist: string[];
        followUps: string[];
      }
    > = {
      policy: {
        checklist: [
          '先确认资助对象、适用学科、申请人资格和项目类别。',
          '再核对时间节点、材料清单、限制性条款和评审关注点。',
          '最后把结论收敛成“是否符合申报条件 / 需要补什么 / 主要风险是什么”。',
        ],
        followUps: [
          '继续补充具体基金名称、项目类别、申报年份和你的个人条件。',
          '如果你贴出指南条款，我可以按条款逐项拆解口径和动作清单。',
        ],
      },
      project: {
        checklist: [
          '先判断选题是否聚焦，核心科学问题和创新点能否用一句话说清。',
          '再检查技术路线是否闭环，阶段目标、验证指标和交付物是否明确。',
          '最后从评审视角回看“必要性、创新性、可行性、基础条件”四个维度。',
        ],
        followUps: [
          '继续贴出题目、摘要、研究目标或技术路线，我可以逐段改写。',
          '如果你愿意，我可以把内容收敛成“背景-问题-创新-路线-风险”结构。',
        ],
      },
      aiRead: {
        checklist: [
          '先提炼研究问题、核心方法、关键实验结果和主要结论。',
          '再补充局限性、适用边界、对比基线和可复用的方法要点。',
          '最后沉淀成可复用的阅读笔记、综述素材或项目启发。',
        ],
        followUps: [
          '继续贴出论文摘要、方法段或实验段，我来做结构化精读。',
          '如果要对比 baseline，我可以改成“方法-证据-优势-局限”格式继续展开。',
        ],
      },
    };

    const referenceBlock =
      citations.length > 0
        ? [
            '已检索到可参考的资料线索：',
            ...citations.slice(0, 3).map(
              (citation, index) =>
                `${index + 1}. [${index + 1}] ${citation.documentTitle}：${citation.content
                  .replace(/\s+/g, ' ')
                  .slice(0, 110)}`,
            ),
          ].join('\n')
        : turn.kbId
          ? '当前知识库没有检索到足够直接的证据，下面先给你一个可执行的通用分析框架。'
          : '当前没有绑定可用知识库，下面先给你一个可执行的通用分析框架。';

    const guidance = routeGuidance[turn.routeMode];
    const checklistBlock = guidance.checklist
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
    const followUpBlock = guidance.followUps.map((item) => `- ${item}`).join('\n');

    return [
      `已切换到“${turn.routeModeDefinition.label}”模式。`,
      errorMessage || '当前改用本地结构化答复链路，先保证你可以继续推进问题。',
      '',
      `你的问题：${turn.content}`,
      '',
      '建议处理路径：',
      checklistBlock,
      '',
      referenceBlock,
      '',
      '下一步你可以这样继续：',
      followUpBlock,
    ].join('\n');
  }

  private normalizeStreamDelta(chunk: string, accumulated: string) {
    if (!chunk) {
      return '';
    }

    if (accumulated && chunk.startsWith(accumulated)) {
      return chunk.slice(accumulated.length);
    }

    return chunk;
  }

  private buildConversationTitle(content: string) {
    const normalized = content.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 40) || 'New conversation';
  }

  private asJsonObject(value?: Prisma.JsonValue | null) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {} as Record<string, unknown>;
    }

    return value as Record<string, unknown>;
  }

  private openSse(response: Response) {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
  }

  private writeSse(response: Response, event: string, payload: unknown) {
    if (response.writableEnded) {
      return;
    }

    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private getHttpStatus(error: unknown) {
    if (error && typeof error === 'object' && 'getStatus' in error) {
      const getStatus = error.getStatus;
      if (typeof getStatus === 'function') {
        return getStatus.call(error);
      }
    }

    return 500;
  }

  private getClientFacingMessage(error: unknown) {
    const status = this.getHttpStatus(error);

    if (status >= 400 && status < 500) {
      return this.getErrorMessage(error);
    }

    return this.getGenerationFallbackNotice(error);
  }

  private getGenerationFallbackNotice(error: unknown) {
    const rawMessage = this.getErrorMessage(error);

    if (/InvalidApiKey|Unauthorized|401/.test(rawMessage)) {
      return '模型服务鉴权失败，已切换为本地结构化答复。';
    }

    if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(rawMessage)) {
      return '模型服务响应超时，已切换为本地结构化答复。';
    }

    if (/network|ENOTFOUND|ECONNREFUSED|socket hang up/i.test(rawMessage)) {
      return '模型服务暂时不可达，已切换为本地结构化答复。';
    }

    return '模型服务暂时不可用，已切换为本地结构化答复。';
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown error';
  }

  private async ensureBootstrapData() {
    const routeModeMap = new Map(
      this.getRouteModeDefinitions().map((definition) => [definition.key, definition]),
    );
    const routeSurfaces = getStigptRouteSurfaceDefinitions();

    for (const surface of routeSurfaces) {
      const routeModes = surface.routeModes
        .map((routeModeKey) => routeModeMap.get(routeModeKey))
        .filter(
          (
            routeMode,
          ): routeMode is RouteModeDefinition => Boolean(routeMode),
        )
        .map(({ key, label, description }) => ({
          key,
          label,
          description,
        }));

      await this.prisma.stigptPageConfig.upsert({
        where: { routeKey: surface.routeKey },
        update: {
          pageTitle: surface.pageTitle,
          assistantName: surface.assistantName,
          welcomeMessage: surface.welcomeMessage,
          inputPlaceholder: surface.inputPlaceholder,
          isActive: true,
          config: {
            layout: 'scholarmate-webidx',
            defaultRouteMode: surface.defaultRouteMode,
            routeModes,
            features: {
              streaming: true,
              citations: true,
              routeModes: routeModes.length > 1,
            },
          } satisfies Prisma.InputJsonValue,
        },
        create: {
          routeKey: surface.routeKey,
          pageTitle: surface.pageTitle,
          assistantName: surface.assistantName,
          welcomeMessage: surface.welcomeMessage,
          inputPlaceholder: surface.inputPlaceholder,
          isActive: true,
          config: {
            layout: 'scholarmate-webidx',
            defaultRouteMode: surface.defaultRouteMode,
            routeModes,
            features: {
              streaming: true,
              citations: true,
              routeModes: routeModes.length > 1,
            },
          } satisfies Prisma.InputJsonValue,
        },
      });
    }

    const modelDefinitions = [
      {
        code: 'policy-assistant',
        name: '政策助手',
        description: '默认政策问答模型。',
        supportedRoutes: ['webIdx', 'answer/policy'],
        isDefault: true,
      },
      {
        code: 'research-copilot',
        name: '项目辅导助手',
        description: '更偏项目分析、申请书辅导与结构诊断。',
        supportedRoutes: ['webIdx', 'answer/project'],
        isDefault: false,
      },
      {
        code: 'ai-reader',
        name: 'AI阅读助手',
        description: '偏论文精读、方法对比和证据提炼的阅读模型。',
        supportedRoutes: ['webIdx', 'aiRead'],
        isDefault: false,
      },
    ];

    for (const modelDefinition of modelDefinitions) {
      await this.prisma.stigptChatModel.upsert({
        where: { code: modelDefinition.code },
        update: {
          name: modelDefinition.name,
          description: modelDefinition.description,
          provider: 'internal',
          supportedRoutes: modelDefinition.supportedRoutes,
          isDefault: modelDefinition.isDefault,
          isActive: true,
        },
        create: {
          code: modelDefinition.code,
          name: modelDefinition.name,
          description: modelDefinition.description,
          provider: 'internal',
          supportedRoutes: modelDefinition.supportedRoutes,
          isDefault: modelDefinition.isDefault,
          isActive: true,
        },
      });
    }

    const modelRecords = await this.prisma.stigptChatModel.findMany({
      where: {
        code: {
          in: modelDefinitions.map((modelDefinition) => modelDefinition.code),
        },
      },
      select: {
        id: true,
        code: true,
      },
    });
    const modelIdMap = new Map(
      modelRecords.map((modelRecord) => [modelRecord.code, modelRecord.id]),
    );

    for (const surface of routeSurfaces) {
      const existingExamples = await this.prisma.stigptExample.count({
        where: { routeKey: surface.routeKey },
      });

      if (existingExamples > 0) {
        continue;
      }

      await this.prisma.stigptExample.createMany({
        data: surface.examples.map((example) => ({
          routeKey: surface.routeKey,
          modelId: example.modelCode
            ? modelIdMap.get(example.modelCode) ?? null
            : null,
          title: example.title,
          prompt: example.prompt,
          sortOrder: example.sortOrder,
          metadata: example.metadata as Prisma.InputJsonValue | undefined,
        })),
      });
    }
  }
}
