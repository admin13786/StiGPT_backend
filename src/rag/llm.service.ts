import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  answer: string;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export type LlmHealthState =
  | 'ready'
  | 'missing_config'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable';

export interface LlmHealthSnapshot {
  state: LlmHealthState;
  provider: string;
  model: string;
  message: string;
  checkedAt: string;
}

class LlmServiceError extends Error {
  constructor(
    message: string,
    readonly code: LlmHealthState,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider = 'dashscope';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ALIYUN_API_KEY') || '';
    this.model = this.configService.get<string>('LLM_MODEL', 'qwen-turbo');
    this.maxTokens = parseInt(this.configService.get<string>('LLM_MAX_TOKENS', '2000'));
    this.baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  }

  /**
   * 调用通义千问 API 生成回答
   */
  async generate(messages: LlmMessage[], temperature: number = 0.7): Promise<LlmResponse> {
    if (!this.apiKey.trim()) {
      throw new LlmServiceError('ALIYUN_API_KEY 未配置，无法调用大模型服务。', 'missing_config');
    }

    try {
      this.logger.log(`Calling Qwen API with ${messages.length} messages`);

      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          input: {
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          },
          parameters: {
            temperature,
            max_tokens: this.maxTokens,
            top_p: 0.8,
            result_format: 'message',
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      if (response.data.output && response.data.output.choices && response.data.output.choices.length > 0) {
        const choice = response.data.output.choices[0];
        const usage = response.data.usage || {};

        this.logger.log(`LLM response received, tokens: ${usage.total_tokens || 0}`);

        return {
          answer: choice.message.content,
          tokenUsage: {
            prompt: usage.input_tokens || 0,
            completion: usage.output_tokens || 0,
            total: usage.total_tokens || 0,
          },
        };
      }

      throw new Error('Invalid response from Qwen API');
    } catch (error) {
      this.logger.error('Failed to call Qwen API', error);
      if (axios.isAxiosError(error)) {
        this.logger.error(`API Error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
      }
      throw this.normalizeError(error);
    }
  }

  /**
   * 流式生成（可选功能）
   */
  async *generateStream(messages: LlmMessage[], temperature: number = 0.7): AsyncGenerator<string> {
    if (!this.apiKey.trim()) {
      throw new LlmServiceError('ALIYUN_API_KEY 未配置，无法调用大模型流式服务。', 'missing_config');
    }

    try {
      this.logger.log(`Calling Qwen API (stream) with ${messages.length} messages`);

      const response = await axios.post(
        this.baseUrl,
        {
          model: this.model,
          input: {
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          },
          parameters: {
            temperature,
            max_tokens: this.maxTokens,
            top_p: 0.8,
            result_format: 'message',
            incremental_output: true,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-SSE': 'enable',
          },
          responseType: 'stream',
          timeout: 60000,
        },
      );

      // 处理 SSE 流
      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.output?.choices?.[0]?.message?.content) {
                yield json.output.choices[0].message.content;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to call Qwen API (stream)', error);
      throw this.normalizeError(error);
    }
  }

  getReadySnapshot(message = '大模型服务可用。'): LlmHealthSnapshot {
    return this.buildSnapshot('ready', message);
  }

  getConfigurationSnapshot(): LlmHealthSnapshot {
    if (!this.apiKey.trim()) {
      return this.buildSnapshot('missing_config', 'ALIYUN_API_KEY 未配置，当前无法调用大模型。');
    }

    return this.buildSnapshot('ready', '大模型配置已就绪。');
  }

  describeError(error: unknown): LlmHealthSnapshot {
    if (error instanceof LlmServiceError) {
      return this.buildSnapshot(error.code, error.message);
    }

    return this.buildSnapshot('unavailable', this.extractErrorMessage(error));
  }

  /**
   * 构建 RAG Prompt
   */
  buildRagPrompt(query: string, contexts: string[]): LlmMessage[] {
    const systemPrompt = `你是一个专业的学术助手，专门帮助用户理解和分析学术论文。

请根据提供的参考文献内容回答用户的问题。要求：
1. 回答要准确、专业，基于提供的参考内容
2. 如果参考内容中没有相关信息，请明确说明
3. 引用参考内容时，使用 [1]、[2] 等标记
4. 保持客观中立，不要添加未经证实的信息
5. 使用清晰的结构组织答案

参考文献：
${contexts.map((ctx, idx) => `[${idx + 1}] ${ctx}`).join('\n\n')}`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ];
  }

  /**
   * 提取引用标记
   */
  extractCitations(answer: string): number[] {
    const citations: number[] = [];
    const regex = /\[(\d+)\]/g;
    let match;

    while ((match = regex.exec(answer)) !== null) {
      const num = parseInt(match[1]);
      if (!citations.includes(num)) {
        citations.push(num);
      }
    }

    return citations.sort((a, b) => a - b);
  }

  private buildSnapshot(state: LlmHealthState, message: string): LlmHealthSnapshot {
    return {
      state,
      provider: this.provider,
      model: this.model,
      message,
      checkedAt: new Date().toISOString(),
    };
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof LlmServiceError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const serverMessage =
        typeof error.response?.data === 'string'
          ? error.response.data
          : JSON.stringify(error.response?.data || {});

      if (status === 401 || status === 403) {
        return new LlmServiceError(
          `大模型鉴权失败（${status}），请检查 ALIYUN_API_KEY。`,
          'unauthorized',
          status,
        );
      }

      if (status === 429) {
        return new LlmServiceError('大模型请求已被限流，请稍后重试。', 'rate_limited', status);
      }

      if (error.code === 'ECONNABORTED') {
        return new LlmServiceError('大模型请求超时，请稍后重试。', 'timeout', status);
      }

      return new LlmServiceError(
        `大模型服务暂时不可用${status ? `（${status}）` : ''}：${serverMessage || error.message}`,
        'unavailable',
        status,
      );
    }

    return new LlmServiceError(this.extractErrorMessage(error), 'unavailable');
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return '大模型服务暂时不可用。';
  }
}
