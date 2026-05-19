import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EncryptionService } from '../common/encryption/encryption.service';

export interface DifyMessageResult {
  text: string;
  status?: number | string | null;
  suggestedOptions: string[];
  detectedIntent: string;
  urgency: 'urgent' | 'non_urgent';
  metadata?: any;
  conversationId?: string;
}

const parseDifyResult = (payload: any): DifyMessageResult => {
  if (!payload || typeof payload !== 'object') {
    return {
      text: '',
      suggestedOptions: [],
      detectedIntent: 'unknown',
      urgency: 'non_urgent',
    };
  }

  const metadata = { ...(payload.metadata || payload.data?.metadata || {}) };

  if (payload.files && Array.isArray(payload.files)) {
    metadata.files = payload.files;
  }

  const pickFirstString = (...values: any[]): string => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) {
        return v;
      }
    }
    return '';
  };

  let text = pickFirstString(
    payload.text,
    payload.answer,
    payload.output,
    payload.initial_reply,
    payload.data?.text,
    payload.data?.answer,
    payload.data?.output,
    payload.data?.content,
    payload.outputs?.text,
    payload.outputs?.answer,
    Array.isArray(payload.outputs) ? payload.outputs[0]?.text : undefined,
    Array.isArray(payload.outputs) ? payload.outputs[0]?.answer : undefined,
    payload.content,
    metadata.text,
    payload.data?.messages?.[0]?.content,
  );

  if (typeof text === 'string' && text.includes('</think>')) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[0]);
        if (jsonData.text) {
          text = jsonData.text;
        }
        if (jsonData.status !== undefined) {
          metadata.status = jsonData.status;
        }
      } catch (e) {
        // 解析失败不影响主流程，静默处理
      }
    }
    text = text.replace(/<\/redacted_reasoning>[\s\S]*$/, '').trim();
  }

  if (
    typeof text === 'string' &&
    text.trim().startsWith('{') &&
    text.trim().endsWith('}')
  ) {
    try {
      const jsonData = JSON.parse(text);
      if (jsonData.text) {
        text = jsonData.text;
      }
      if (jsonData.status !== undefined) {
        metadata.status = jsonData.status;
      }
    } catch {
      /* ignore */
    }
  }

  const status =
    payload.status ??
    payload.state ??
    payload.workflow_status ??
    metadata.status ??
    metadata.workflow_status;

  const suggestedOptions =
    payload.suggested_options ||
    metadata.suggested_options ||
    payload.options ||
    [];

  return {
    text,
    status: status ?? null,
    suggestedOptions: Array.isArray(suggestedOptions) ? suggestedOptions : [],
    detectedIntent: 'unknown',
    urgency: 'non_urgent',
    metadata,
    conversationId: payload.conversation_id,
  };
};

@Injectable()
export class DifyService {
  private readonly logger = new Logger(DifyService.name);
  private readonly triageMode: 'chat' | 'workflow';

  // AI 调用超时时间 (8秒)，超时则使用默认回复
  private readonly AI_TIMEOUT = 8000;

  constructor(
    private configService: ConfigService,
    private encryptionService: EncryptionService,
    private httpService: HttpService,
  ) {
    const mode =
      (this.configService.get<string>('DIFY_TRIAGE_MODE') || 'chat').toLowerCase();
    this.triageMode = mode === 'workflow' ? 'workflow' : 'chat';
  }

  /**
   * 解密 API Key（如果已加密）
   * 加密格式: iv:tag:encrypted (三段由冒号分隔)
   * 未加密格式: app-xxx (以 app- 开头)
   */
  private decryptApiKey(encryptedApiKey: string): string {
    if (!encryptedApiKey) {
      return encryptedApiKey;
    }

    // 检查是否是未加密的 API Key（以 app- 开头）
    if (encryptedApiKey.startsWith('app-')) {
      return encryptedApiKey;
    }

    // 检查是否符合加密格式（三段由冒号分隔）
    const parts = encryptedApiKey.split(':');
    if (parts.length !== 3) {
      // 不符合加密格式，直接返回原值
      return encryptedApiKey;
    }

    try {
      return this.encryptionService.decrypt(encryptedApiKey);
    } catch (error) {
      this.logger.warn(`API Key 解密失败，使用原始值: ${error.message}`);
      return encryptedApiKey; // 向后兼容
    }
  }

  /**
   * 调用 Dify 进行问题分流
   * 对话模式直接调用 chat API，工作流模式走 workflows/run
   */
  async triage(
    description: string,
    apiKey: string,
    baseUrl: string,
  ): Promise<DifyMessageResult> {
    const isWorkflowMode = this.triageMode === 'workflow';

    if (!isWorkflowMode) {
      try {
        return await this.triageWithChatAPI(description, apiKey, baseUrl);
      } catch (chatError: any) {
        const chatErrorResponse = chatError.response?.data;
        this.logger.error(
          `triage 对话API失败，尝试工作流API: ${JSON.stringify({
            message: chatErrorResponse?.message || chatError.message,
            code: chatErrorResponse?.code,
            status: chatError.response?.status,
            url: `${baseUrl}/chat-messages`,
            responseData: chatErrorResponse,
          })}`,
        );
      }
    }

    const decryptedApiKey = this.decryptApiKey(apiKey);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/workflows/run`,
          {
            inputs: {
              description,
            },
            response_mode: 'blocking',
            user: 'system',
          },
          {
            headers: {
              Authorization: `Bearer ${decryptedApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.AI_TIMEOUT,
          },
        ),
      );

      const output =
        response.data?.outputs || response.data?.data?.outputs || response.data;
      return parseDifyResult(output);
    } catch (error: any) {
      const errorResponse = error.response?.data;
      this.logger.error(
        `triage 工作流API调用失败，尝试对话API: ${JSON.stringify({
          message: errorResponse?.message || error.message,
          code: errorResponse?.code,
          status: error.response?.status,
          url: `${baseUrl}/workflows/run`,
          responseData: errorResponse,
        })}`,
      );

      try {
        return await this.triageWithChatAPI(description, apiKey, baseUrl);
      } catch (chatError: any) {
        const chatErrorResponse = chatError.response?.data;
        this.logger.error(
          `triage 对话API也失败: ${JSON.stringify({
            message: chatErrorResponse?.message || chatError.message,
            code: chatErrorResponse?.code,
            status: chatError.response?.status,
            url: `${baseUrl}/chat-messages`,
            responseData: chatErrorResponse,
          })}`,
        );

        return {
          text: '您好，感谢您的反馈。我们正在为您处理，请稍候...',
          suggestedOptions: ['转人工客服', '查看常见问题'],
          detectedIntent: 'unknown',
          urgency: 'non_urgent',
        };
      }
    }
  }

  async triageWithChatAPI(
    description: string,
    apiKey: string,
    baseUrl: string,
  ): Promise<DifyMessageResult> {
    const decryptedApiKey = this.decryptApiKey(apiKey);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/chat-messages`,
          {
            inputs: {
              description,
            },
            query: description,
            response_mode: 'blocking',
            user: 'system',
          },
          {
            headers: {
              Authorization: `Bearer ${decryptedApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.AI_TIMEOUT,
          },
        ),
      );

      // 解析Dify对话API返回的数据
      const parsed = parseDifyResult(response.data);
      if (!parsed.text) {
        parsed.text = description || '您好，我正在为您分析问题...';
        try {
          this.logger.warn(
            `triageWithChatAPI empty text, raw response: ${JSON.stringify(
              response.data,
            )}`,
          );
        } catch {
          /* ignore stringify errors */
        }
      }
      if (!parsed.suggestedOptions.length) {
        parsed.suggestedOptions = ['转人工客服', '查看常见问题'];
      }
      return parsed;
    } catch (error: any) {
      const errorResponse = error.response?.data;
      this.logger.error(
        `triageWithChatAPI 失败: ${JSON.stringify({
          message: errorResponse?.message || error.message,
          code: errorResponse?.code,
          status: error.response?.status,
          url: `${baseUrl}/chat-messages`,
          responseData: errorResponse,
        })}`,
      );
      throw error;
    }
  }

  /**
   * 发送对话消息（支持会话持久化）
   * 根据您提供的API文档：POST /chat-messages
   */
  async sendChatMessage(
    query: string,
    apiKey: string,
    baseUrl: string,
    conversationId?: string,
    userId?: string,
  ): Promise<DifyMessageResult> {
    const decryptedApiKey = this.decryptApiKey(apiKey);

    try {
      const requestBody: any = {
        inputs: {},
        query,
        response_mode: 'blocking',
        user: userId || 'system',
      };

      // 如果提供了会话ID，添加到请求中（支持会话持久化）
      if (conversationId) {
        requestBody.conversation_id = conversationId;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/chat-messages`,
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${decryptedApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.AI_TIMEOUT,
          },
        ),
      );

      const parsed = parseDifyResult(response.data);
      // 检查 text 是否为空或仅包含空白字符
      if (!parsed.text || !parsed.text.trim()) {
        parsed.text = query || '您好，我正在为您处理请求...';
      }
      parsed.conversationId =
        response.data?.conversation_id ?? parsed.conversationId;
      return parsed;
    } catch (error: any) {
      // 完整记录错误信息
      const errorResponse = error.response?.data;
      const errorMessage = errorResponse?.message || error.message;
      const errorCode = errorResponse?.code;

      this.logger.error(
        `sendChatMessage 失败: ${JSON.stringify({
          message: errorMessage,
          code: errorCode,
          status: error.response?.status,
          url: `${baseUrl}/chat-messages`,
          responseData: errorResponse,
        })}`,
      );

      throw new HttpException(
        errorMessage || 'Dify API调用失败',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 优化客服回复（AI辅助）
   * 使用专门的 AI 话术优化 API（从环境变量读取）
   */
  async optimizeReply(
    content: string,
    context: string,
    _apiKey?: string, // 不再使用，保留参数兼容性
    _baseUrl?: string, // 不再使用，保留参数兼容性
    conversationId?: string,
  ): Promise<string> {
    // 使用环境变量中的 AI 话术优化 API 配置
    const optimizeApiKey = this.configService.get<string>('DIFY_API_KEY');
    const optimizeBaseUrl = this.configService.get<string>('DIFY_BASE_URL');

    if (!optimizeApiKey || !optimizeBaseUrl) {
      this.logger.warn('AI话术优化 API 未配置，返回原文');
      return content;
    }

    try {
      const query = `请优化以下游戏客服回复内容，使其更加专业和友好：\n${content}\n\n上下文信息：\n${context}`;

      // 环境变量中的 API Key 未加密，直接使用
      const decryptedApiKey = optimizeApiKey;

      const requestBody: any = {
        inputs: {},
        query,
        response_mode: 'blocking',
        user: 'system',
      };

      if (conversationId) {
        requestBody.conversation_id = conversationId;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          `${optimizeBaseUrl}/chat-messages`,
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${decryptedApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.AI_TIMEOUT,
          },
        ),
      );

      const parsed = parseDifyResult(response.data);
      return parsed.text || content;
    } catch (error: any) {
      const errorResponse = error.response?.data;
      this.logger.error(
        `optimizeReply 失败: ${JSON.stringify({
          message: errorResponse?.message || error.message,
          code: errorResponse?.code,
          status: error.response?.status,
          url: `${optimizeBaseUrl}/chat-messages`,
          responseData: errorResponse,
        })}`,
      );
      return content; // 失败时返回原文
    }
  }

  /**
   * 获取会话历史消息
   * GET /messages?conversation_id={conversation_id}
   */
  async getConversationHistory(
    conversationId: string,
    apiKey: string,
    baseUrl: string,
    limit: number = 20,
  ): Promise<any[]> {
    const decryptedApiKey = this.decryptApiKey(apiKey);

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/messages`, {
          params: {
            conversation_id: conversationId,
            limit,
          },
          headers: {
            Authorization: `Bearer ${decryptedApiKey}`,
          },
          timeout: this.AI_TIMEOUT,
        }),
      );

      return response.data?.data || [];
    } catch (error: any) {
      const errorResponse = error.response?.data;
      this.logger.error(
        `getConversationHistory 失败: ${JSON.stringify({
          message: errorResponse?.message || error.message,
          code: errorResponse?.code,
          status: error.response?.status,
          url: `${baseUrl}/messages`,
          responseData: errorResponse,
        })}`,
      );
      return [];
    }
  }

  /**
   * 获取会话列表
   * GET /conversations
   */
  async getConversationList(
    apiKey: string,
    baseUrl: string,
    userId?: string,
    limit: number = 20,
  ): Promise<any[]> {
    const decryptedApiKey = this.decryptApiKey(apiKey);

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/conversations`, {
          params: {
            user: userId || 'system',
            limit,
          },
          headers: {
            Authorization: `Bearer ${decryptedApiKey}`,
          },
          timeout: this.AI_TIMEOUT,
        }),
      );

      return response.data?.data || [];
    } catch (error: any) {
      const errorResponse = error.response?.data;
      this.logger.error(
        `getConversationList 失败: ${JSON.stringify({
          message: errorResponse?.message || error.message,
          code: errorResponse?.code,
          status: error.response?.status,
          url: `${baseUrl}/conversations`,
          responseData: errorResponse,
        })}`,
      );
      return [];
    }
  }
}
