/**
 * Linly-Talker 服务封装
 * 
 * 调用 Linly-Talker 的三个 FastAPI 微服务：
 * - TTS (端口 8001): 文字转语音
 * - LLM (端口 8002): 大语言模型对话
 * - Talker (端口 8003): 图片+音频 → 数字人视频
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import FormData = require('form-data');
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface LinlyTalkerHealth {
  tts: boolean;
  llm: boolean;
  talker: boolean;
}

export interface ChatTask {
  id: string;
  question: string;
  answer?: string;
  status: 'pending' | 'tts' | 'generating' | 'success' | 'failed';
  message?: string;
  videoUrl?: string;
  audioUrl?: string;
  createdAt: Date;
}

@Injectable()
export class LinlyTalkerService {
  private readonly logger = new Logger(LinlyTalkerService.name);
  private readonly ttsUrl: string;
  private readonly talkerUrl: string;
  private readonly outputDir: string;

  // 阿里百炼 LLM 配置
  private readonly aliyunApiKey: string;
  private readonly llmModel: string;
  private readonly llmBaseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

  // 内存任务存储
  private tasks = new Map<string, ChatTask>();

  // 默认数字人形象图片路径
  private defaultAvatarImage: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.ttsUrl = this.configService.get('LINLY_TTS_URL', 'http://127.0.0.1:8001');
    this.talkerUrl = this.configService.get('LINLY_TALKER_URL', 'http://127.0.0.1:8003');
    this.outputDir = this.configService.get('LINLY_OUTPUT_DIR', 'uploads/linly-talker');
    this.defaultAvatarImage = this.configService.get(
      'LINLY_AVATAR_IMAGE',
      'Linly-Talker/inputs/example.png',
    );

    // 阿里百炼 LLM
    this.aliyunApiKey = this.configService.get('ALIYUN_API_KEY', '');
    this.llmModel = this.configService.get('LLM_MODEL', 'qwen-turbo');

    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 检查三个服务的健康状态
   */
  async checkHealth(): Promise<LinlyTalkerHealth> {
    const check = async (url: string): Promise<boolean> => {
      try {
        await firstValueFrom(
          this.httpService.get(`${url}/docs`, { timeout: 3000 }),
        );
        return true;
      } catch {
        return false;
      }
    };

    const [tts, talker] = await Promise.all([
      check(this.ttsUrl),
      check(this.talkerUrl),
    ]);

    // LLM 使用阿里百炼云端 API，只要有 API Key 就视为在线
    const llm = !!this.aliyunApiKey;

    return { tts, llm, talker };
  }

  /**
   * 调用阿里百炼通义千问生成回复
   */
  async chat(question: string): Promise<string> {
    try {
      const response = await axios.post(
        this.llmBaseUrl,
        {
          model: this.llmModel,
          input: {
            messages: [
              {
                role: 'system',
                content: '你是科研之友 AI 助手，一个专业的学术数字人。请用简洁、专业的语言回答用户的问题，回答控制在200字以内。',
              },
              { role: 'user', content: question },
            ],
          },
          parameters: {
            temperature: 0.7,
            max_tokens: 500,
            top_p: 0.8,
            result_format: 'message',
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.aliyunApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const choices = response.data?.output?.choices;
      if (choices && choices.length > 0) {
        return choices[0].message.content;
      }
      throw new Error('通义千问 API 返回为空');
    } catch (err: any) {
      this.logger.error(`通义千问调用失败: ${err.message}`);
      // 降级：直接回复问题本身
      return `收到您的问题：${question}。当前 AI 服务暂时不可用，请稍后再试。`;
    }
  }

  /**
   * 调用 TTS 生成音频，返回音频文件路径
   */
  async tts(text: string, savePath?: string): Promise<string> {
    const fileName = savePath || `${uuidv4()}.wav`;
    const outputPath = path.join(this.outputDir, fileName);

    const formData = new FormData();
    formData.append('text', text);
    formData.append('tts_method', 'EdgeTTS');
    formData.append('voice', 'zh-CN-XiaoxiaoNeural');
    formData.append('save_path', 'answer.wav');

    const response = await firstValueFrom(
      this.httpService.post(`${this.ttsUrl}/tts_response/`, formData, {
        headers: formData.getHeaders(),
        responseType: 'arraybuffer',
        timeout: 30000,
      }),
    );

    fs.writeFileSync(outputPath, response.data);
    this.logger.log(`TTS 音频生成: ${fileName}`);
    return fileName;
  }

  /**
   * 调用 Talker 生成数字人视频
   */
  async generateVideo(
    audioFileName: string,
    imageFilePath?: string,
  ): Promise<string> {
    const videoFileName = `${uuidv4()}.mp4`;
    const videoOutputPath = path.join(this.outputDir, videoFileName);
    const audioPath = path.join(this.outputDir, audioFileName);
    const imagePath = imageFilePath || this.defaultAvatarImage;

    const formData = new FormData();
    formData.append('source_image', fs.createReadStream(imagePath));
    formData.append('driven_audio', fs.createReadStream(audioPath));
    formData.append('talker_method', 'SadTalker');
    formData.append('preprocess_type', 'crop');
    formData.append('is_still_mode', 'False');
    formData.append('enhancer', 'False');
    formData.append('batch_size', '4');
    formData.append('size_of_image', '256');
    formData.append('pose_style', '0');
    formData.append('facerender', 'facevid2vid');
    formData.append('exp_weight', '1.0');
    formData.append('blink_every', 'True');
    formData.append('fps', '30');

    const response = await firstValueFrom(
      this.httpService.post(`${this.talkerUrl}/talker_response/`, formData, {
        headers: formData.getHeaders(),
        responseType: 'arraybuffer',
        timeout: 120000,
      }),
    );

    fs.writeFileSync(videoOutputPath, response.data);
    this.logger.log(`数字人视频生成: ${videoFileName}`);
    return videoFileName;
  }

  /**
   * 完整对话流程：问题 → LLM回复 → TTS音频 → 数字人视频
   */
  async createChatTask(question: string, avatarImage?: string): Promise<string> {
    const taskId = uuidv4();

    this.tasks.set(taskId, {
      id: taskId,
      question,
      status: 'pending',
      message: '正在思考...',
      createdAt: new Date(),
    });

    // 异步执行
    this.processChatTask(taskId, question, avatarImage).catch((err) => {
      this.logger.error(`数字人对话任务失败: ${taskId}`, err);
      const task = this.tasks.get(taskId);
      if (task) {
        this.tasks.set(taskId, {
          ...task,
          status: 'failed',
          message: err.message || '处理失败',
        });
      }
    });

    return taskId;
  }

  private async processChatTask(
    taskId: string,
    question: string,
    avatarImage?: string,
  ) {
    // 1. LLM 生成回复（阿里百炼通义千问）
    this.updateTask(taskId, { status: 'pending', message: '正在生成回复...' });
    const answer = await this.chat(question);
    this.updateTask(taskId, { answer, message: '回复已生成' });

    // 2. 尝试 TTS 生成音频（可能失败，降级处理）
    try {
      this.updateTask(taskId, { status: 'tts', message: '正在合成语音...' });
      const audioFileName = await this.tts(answer);
      this.updateTask(taskId, {
        audioUrl: `/uploads/linly-talker/${audioFileName}`,
        message: '语音合成完成',
      });

      // 3. 尝试 Talker 生成视频（可能失败，降级处理）
      try {
        this.updateTask(taskId, { status: 'generating', message: '正在生成数字人视频...' });
        const videoFileName = await this.generateVideo(audioFileName, avatarImage);
        this.updateTask(taskId, {
          status: 'success',
          videoUrl: `/uploads/linly-talker/${videoFileName}`,
          message: '生成完成',
        });
      } catch (videoErr: any) {
        this.logger.warn(`Talker 视频生成失败，降级为音频模式: ${videoErr.message}`);
        this.updateTask(taskId, {
          status: 'success',
          message: '视频服务不可用，已返回语音回复',
        });
      }
    } catch (ttsErr: any) {
      this.logger.warn(`TTS 语音合成失败，降级为文字模式: ${ttsErr.message}`);
      this.updateTask(taskId, {
        status: 'success',
        message: 'TTS 服务不可用，已返回文字回复',
      });
    }
  }

  private updateTask(taskId: string, updates: Partial<ChatTask>) {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, ...updates });
    }
  }

  getTask(taskId: string): ChatTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): ChatTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * 切换 TTS 模型
   */
  async changeTtsModel(modelName: string): Promise<any> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.ttsUrl}/tts_change_model/`,
        null,
        { params: { model_name: modelName }, timeout: 30000 },
      ),
    );
    return response.data;
  }

  /**
   * 切换 LLM 模型（阿里百炼云端，无需本地切换）
   */
  async changeLlmModel(modelName: string): Promise<any> {
    this.logger.log(`LLM 使用阿里百炼云端 API，模型: ${this.llmModel}，无需本地切换`);
    return { message: `当前使用阿里百炼 ${this.llmModel} 模型` };
  }

  /**
   * 切换 Talker 模型
   */
  async changeTalkerModel(modelName: string): Promise<any> {
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.talkerUrl}/talker_change_model/`,
        null,
        { params: { model_name: modelName }, timeout: 60000 },
      ),
    );
    return response.data;
  }
}
