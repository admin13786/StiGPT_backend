/**
 * 阿里云 LLM 服务
 * 直接调用阿里云 DashScope API，不通过 Dify
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { getPersonaById, getDefaultPersona } from '../constants/personas';

export interface AliyunLLMResponse {
  text: string;
  conversationId?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

@Injectable()
export class AliyunLLMService {
  private readonly logger = new Logger(AliyunLLMService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  private readonly timeout = 30000; // 30秒超时

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('ALIYUN_API_KEY') || '';
  }

  /**
   * 发送聊天消息
   */
  async chat(
    messages: Array<{ role: string; content: string }>,
    personaId?: string,
  ): Promise<AliyunLLMResponse> {
    if (!this.apiKey) {
      throw new Error('阿里云 API Key 未配置');
    }

    // 获取人格配置
    const persona = personaId ? getPersonaById(personaId) : getDefaultPersona();
    if (!persona) {
      throw new Error(`人格 ${personaId} 不存在`);
    }

    // 构建消息列表，添加系统提示词
    const fullMessages = [
      {
        role: 'system',
        content: persona.systemPrompt,
      },
      ...messages,
    ];

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.baseUrl,
          {
            model: 'qwen-turbo',
            input: {
              messages: fullMessages,
            },
            parameters: {
              temperature: persona.temperature,
              top_p: 0.8,
              max_tokens: 2000,
              result_format: 'message',
            },
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: this.timeout,
          },
        ),
      );

      const output = response.data?.output;
      if (!output || !output.choices || output.choices.length === 0) {
        throw new Error('阿里云 API 返回数据格式错误');
      }

      const choice = output.choices[0];
      const text = choice.message?.content || '';

      return {
        text,
        usage: response.data?.usage,
      };
    } catch (error: any) {
      this.logger.error('阿里云 LLM 调用失败:', error.message);
      throw error;
    }
  }

  /**
   * 简单的单轮对话
   */
  async simpleChat(userMessage: string, personaId?: string): Promise<string> {
    const response = await this.chat(
      [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      personaId,
    );

    return response.text;
  }
}
