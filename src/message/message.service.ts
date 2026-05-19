import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes, throwSessionNotFound } from '../common/exceptions';
import { CreateMessageDto } from './dto/create-message.dto';
import { SenderType, MessageType } from '@prisma/client';
import { TranslationService } from '../shared/translation/translation.service';
import {
  SessionMetadata,
  MessageMetadata,
} from '../common/types/metadata.types';
import { AppLogger } from '../common/logger/app-logger.service';

@Injectable()
export class MessageService {
  private readonly logger: AppLogger;

  constructor(
    private prisma: PrismaService,
    private translationService: TranslationService,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(MessageService.name);
  }

  // 创建消息
  async create(
    createMessageDto: CreateMessageDto,
    senderType: SenderType,
    senderId?: string,
    currentUser?: { id: string; role: string },
  ) {
    // 验证会话存在
    const session = await this.prisma.session.findUnique({
      where: { id: createMessageDto.sessionId },
    });

    if (!session) {
      throwSessionNotFound(createMessageDto.sessionId);
    }

    // 权限检查：如果是客服发送消息，只能发送到自己处理的会话
    if (senderType === 'AGENT' && senderId && currentUser) {
      if (currentUser.role === 'AGENT') {
        // 客服只能发送消息到自己处理的会话
        if (session.agentId !== senderId) {
          throw new BusinessException(
            ErrorCodes.SESSION_ALREADY_ASSIGNED,
            '无权发送消息：该会话已分配给其他客服，只有处理该会话的客服才能回复',
          );
        }
        // 检查会话状态，必须是IN_PROGRESS状态才能发送消息
        if (session.status !== 'IN_PROGRESS') {
          throw new BusinessException(
            ErrorCodes.SESSION_INVALID_STATUS,
            '会话未接入，请先接入会话后才能发送消息',
          );
        }
      }
    }

    const createdMessage = await this.prisma.message.create({
      data: {
        sessionId: createMessageDto.sessionId,
        senderType,
        senderId: senderId || null,
        content: createMessageDto.content,
        messageType:
          (createMessageDto.messageType as MessageType) || MessageType.TEXT,
      },
      include: {
        ...(senderType === 'AGENT' && senderId
          ? {
              agent: {
                select: {
                  id: true,
                  username: true,
                  realName: true,
                },
              },
            }
          : {}),
        session: true, // 加载 session 以获取 metadata
      },
    });

    // 触发语言自动检测（仅针对玩家的第一条/前几条消息）
    if (senderType === 'PLAYER' && createdMessage.messageType === 'TEXT') {
      this.detectLanguageInBackground(session, createdMessage.content);
    }

    // 自动翻译：如果是 AI 或 客服发出的消息，且已知玩家语言非中文，自动翻译给玩家
    if (
      (senderType === 'AI' || senderType === 'AGENT') &&
      createdMessage.messageType === 'TEXT'
    ) {
      const sessionMeta = (createdMessage.session?.metadata ||
        {}) as SessionMetadata;
      const playerLang = sessionMeta.playerLanguage;

      this.logger.debug(
        `[AutoTranslate] Checking message ${createdMessage.id} from ${senderType}. PlayerLang: ${playerLang}`,
      );

      // 假设系统/客服默认语言是 zh，如果玩家语言存在且不是 zh，则翻译
      if (playerLang && playerLang !== 'zh') {
        this.logger.log(
          `[AutoTranslate] Triggering translation for message ${createdMessage.id} to ${playerLang}`,
        );
        this.translateMessage(createdMessage.id, playerLang).catch((err) =>
          this.logger.error(
            `Auto-translation for message ${createdMessage.id} failed:`,
            err,
          ),
        );
      } else {
        this.logger.debug(
          `[AutoTranslate] Skipped. PlayerLang is ${playerLang}`,
        );
      }
    }

    return createdMessage;
  }

  // 获取会话消息列表
  async findBySession(sessionId: string, limit?: number) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throwSessionNotFound(sessionId);
    }

    return this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: limit,
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
  }

  // 创建AI消息
  async createAIMessage(sessionId: string, content: string, metadata?: any) {
    this.logger.log(
      `[createAIMessage] 创建AI消息: sessionId=${sessionId}, content长度=${content.length}`,
    );
    const createDto = {
      sessionId,
      content,
      messageType: MessageType.TEXT as any,
    };
    return this.create(createDto, 'AI').then((message) => {
      this.logger.log(
        `[createAIMessage] AI消息创建成功: messageId=${message.id}`,
      );
      if (metadata) {
        return this.prisma.message.update({
          where: { id: message.id },
          data: { metadata },
        });
      }
      return message;
    });
  }

  // 创建系统通知消息
  async createSystemMessage(sessionId: string, content: string) {
    const createDto = {
      sessionId,
      content,
      messageType: MessageType.SYSTEM_NOTICE as any,
    };
    return this.create(createDto, 'SYSTEM');
  }

  // 翻译指定消息
  async translateMessage(messageId: string, targetLang?: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { session: true }, // 需要读取 session context
    });

    if (!message) {
      throw new BusinessException(ErrorCodes.MESSAGE_NOT_FOUND);
    }

    // 1. 检查是否已有缓存
    const meta = (message.metadata || {}) as MessageMetadata;

    // 确定目标语言：优先使用传入的 targetLang，否则使用 Session 中的玩家语言，最后默认使用中文
    let requestedTarget = targetLang;
    if (!requestedTarget && message.session?.metadata) {
      const sessionMeta = message.session.metadata as SessionMetadata;
      requestedTarget = sessionMeta.playerLanguage || 'zh';
    }
    requestedTarget = requestedTarget || 'zh';

    // ✅ 添加验证：确保目标语言是有效的语言代码，而不是消息内容
    // 支持的语言：中文、英语、日语、韩语、西班牙语、法语、德语、俄语
    const validLanguageCodes = [
      'zh',
      'en',
      'ja',
      'jp',
      'ko',
      'kor',
      'es',
      'spa',
      'fr',
      'fra',
      'de',
      'ru',
      'auto',
    ];
    const isValidLangCode =
      requestedTarget &&
      requestedTarget.length <= 4 && // 支持3-4位语言代码（如 kor, fra, spa）
      (validLanguageCodes.includes(requestedTarget.toLowerCase()) ||
        /^[a-z]{2,3}$/i.test(requestedTarget));

    if (!isValidLangCode) {
      this.logger.warn(
        `Invalid target language code: "${requestedTarget}", using default "zh"`,
      );
      requestedTarget = 'zh';
    } else {
      requestedTarget = requestedTarget.toLowerCase();
    }

    // 如果已有相同目标语言的翻译，直接返回（缓存命中）
    if (
      meta.translation &&
      meta.translation.targetLanguage === requestedTarget &&
      meta.translation.translatedContent &&
      meta.translation.translatedContent.trim().length > 0
    ) {
      this.logger.log(
        `Translation cache hit for message ${messageId}, target: ${requestedTarget}`,
      );
      return message;
    }

    // 2. 调用翻译服务
    try {
      this.logger.debug(
        `Translating message ${messageId}: content length=${message.content?.length || 0}, targetLang=${requestedTarget}`,
      );

      // 确定源语言：如果是 AI 或客服消息，源语言为 'zh'；如果是玩家消息，使用 'auto'
      const sourceLang =
        message.senderType === 'AI' || message.senderType === 'AGENT'
          ? 'zh'
          : 'auto';

      const result = await this.translationService.translate(
        message.content,
        requestedTarget,
        sourceLang, // 明确指定源语言
      );
      this.logger.log(
        `Translation success: message ${messageId}, ${result.sourceLanguage} -> ${result.targetLanguage}`,
      );

      // 3. 更新消息 Metadata
      const updatedMeta: MessageMetadata = {
        ...meta,
        translation: {
          translatedContent: result.content,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          provider: result.provider,
          translatedAt: new Date().toISOString(),
        },
      };

      return await this.prisma.message.update({
        where: { id: messageId },
        data: { metadata: updatedMeta as any },
      });
    } catch (error) {
      // 记录详细错误日志
      this.logger.error('Translation failed', error);
      this.logger.error(
        `Error details: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'N/A'}`,
      );

      // 返回更详细的错误信息
      const errorMessage =
        error instanceof Error ? error.message : '翻译失败，请稍后重试';
      throw new BusinessException(ErrorCodes.SYSTEM_INTERNAL_ERROR, `翻译失败: ${errorMessage}`);
    }
  }

  // 后台执行语言检测
  private async detectLanguageInBackground(session: any, content: string) {
    try {
      // 如果已经锁定语言，不再检测
      const sessionMeta = (session.metadata || {}) as SessionMetadata;
      if (sessionMeta.language?.isLocked) {
        return;
      }

      // 如果检测历史超过 20 次，不再频繁检测，但为了保持活跃可适当放宽
      const history = sessionMeta.languageDetectionHistory || [];
      if (history.length >= 20) {
        return;
      }

      // 执行检测
      const result = await this.translationService.detect(content);

      // ✅ 验证检测结果：确保是有效的语言代码
      // 支持的语言：中文、英语、日语、韩语、西班牙语、法语、德语、俄语
      const validLanguageCodes = [
        'zh',
        'en',
        'ja',
        'jp',
        'ko',
        'kor',
        'es',
        'spa',
        'fr',
        'fra',
        'de',
        'ru',
      ];
      let detectedLang = result.language;

      // 如果检测结果不是有效的语言代码，使用默认值
      // 支持3-4位的语言代码（如 kor, fra, spa）
      if (
        !detectedLang ||
        detectedLang.length > 4 ||
        !validLanguageCodes.includes(detectedLang.toLowerCase())
      ) {
        this.logger.warn(
          `[Language Detection] Invalid detected language: "${detectedLang}", using "zh"`,
        );
        detectedLang = 'zh';
      } else {
        detectedLang = detectedLang.toLowerCase();
      }

      // 更新 Session Metadata
      const newHistoryItem = {
        messageId: 'auto',
        language: detectedLang,
        confidence: result.confidence || 0.8,
        detectedAt: new Date().toISOString(),
      };

      const updatedHistory = [...history, newHistoryItem];

      // 简单策略：如果置信度高，或者连续3次一致，则锁定
      const isConfident = (result.confidence || 0) > 0.9;
      const confirmLang = isConfident
        ? detectedLang
        : sessionMeta.playerLanguage &&
            validLanguageCodes.includes(
              sessionMeta.playerLanguage.toLowerCase(),
            )
          ? sessionMeta.playerLanguage.toLowerCase()
          : detectedLang;

      const newMeta: SessionMetadata = {
        ...sessionMeta,
        playerLanguage: confirmLang,
        languageDetectionHistory: updatedHistory,
        language: {
          ...(sessionMeta.language || {}),
          detected: confirmLang,
          confidence: result.confidence || 0,
          isLocked: isConfident, // 锁定条件可优化
          detectedAt: new Date().toISOString(),
        },
      };

      await this.prisma.session.update({
        where: { id: session.id },
        data: { metadata: newMeta as any },
      });
    } catch (error) {
      this.logger.error(
        'Background language detection failed',
        error instanceof Error ? error.stack : undefined,
        {
          sessionId: session.id,
          contentPreview: content.substring(0, 50),
        },
      );
      // 不抛出异常，以免影响主流程
    }
  }
}
