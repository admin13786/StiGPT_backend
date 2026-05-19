/**
 * Duix-Avatar 本地服务封装
 * 
 * 依赖 Duix-Avatar Docker 服务：
 * - TTS (fish-speech): http://127.0.0.1:18180
 * - 视频合成 (duix.avatar): http://127.0.0.1:8383
 */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export interface VideoTask {
  id: string;
  text: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  progress?: number;
  message?: string;
  videoUrl?: string;
  createdAt: Date;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly ttsUrl: string;
  private readonly f2fUrl: string;
  private readonly dataPath: string;

  // 内存中存储任务状态（生产环境应该用数据库）
  private tasks = new Map<string, VideoTask>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.ttsUrl = this.configService.get('DUIX_TTS_URL', 'http://127.0.0.1:18180');
    this.f2fUrl = this.configService.get('DUIX_F2F_URL', 'http://127.0.0.1:8383');
    this.dataPath = this.configService.get('DUIX_DATA_PATH', 'D:/duix_avatar_data/face2face/temp');
  }

  /**
   * 调用 TTS 生成音频
   */
  async generateAudio(
    text: string,
    referenceAudio: string,
    referenceText: string,
  ): Promise<string> {
    const speaker = uuidv4();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.ttsUrl}/v1/invoke`,
        {
          speaker,
          text,
          format: 'wav',
          topP: 0.7,
          max_new_tokens: 1024,
          chunk_length: 100,
          repetition_penalty: 1.2,
          temperature: 0.7,
          need_asr: false,
          streaming: false,
          is_fixed_seed: 0,
          is_norm: 1,
          reference_audio: referenceAudio,
          reference_text: referenceText,
        },
        { responseType: 'arraybuffer', timeout: 60000 },
      ),
    );

    // 保存音频文件
    const audioFileName = `${speaker}.wav`;
    const audioPath = path.join(this.dataPath, audioFileName);

    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }

    fs.writeFileSync(audioPath, response.data);
    this.logger.log(`音频生成成功: ${audioFileName}`);

    return audioFileName;
  }

  /**
   * 提交视频合成任务
   */
  async submitVideoTask(
    audioPath: string,
    videoPath: string,
  ): Promise<{ code: string; result: any }> {
    const code = uuidv4();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.f2fUrl}/easy/submit`,
        {
          audio_url: audioPath,
          video_url: videoPath,
          code,
          chaofen: 0,
          watermark_switch: 0,
          pn: 1,
        },
        { timeout: 30000 },
      ),
    );

    this.logger.log(`视频任务已提交: ${code}`);
    return { code, result: response.data };
  }

  /**
   * 查询视频合成进度
   */
  async queryVideoProgress(taskCode: string): Promise<any> {
    const response = await firstValueFrom(
      this.httpService.get(`${this.f2fUrl}/easy/query?code=${taskCode}`, {
        timeout: 10000,
      }),
    );

    return response.data;
  }

  /**
   * 完整流程：文本 → 音频 → 视频
   */
  async createVideoFromText(
    text: string,
    modelVideoPath: string,
    referenceAudio: string,
    referenceText: string,
  ): Promise<string> {
    const taskId = uuidv4();

    // 创建任务记录
    this.tasks.set(taskId, {
      id: taskId,
      text,
      status: 'pending',
      message: '正在生成音频...',
      createdAt: new Date(),
    });

    // 异步执行，不阻塞请求
    this.processVideoTask(
      taskId,
      text,
      modelVideoPath,
      referenceAudio,
      referenceText,
    ).catch((err) => {
      this.logger.error(`视频任务失败: ${taskId}`, err);
      this.tasks.set(taskId, {
        ...this.tasks.get(taskId)!,
        status: 'failed',
        message: err.message || '视频生成失败',
      });
    });

    return taskId;
  }

  private async processVideoTask(
    taskId: string,
    text: string,
    modelVideoPath: string,
    referenceAudio: string,
    referenceText: string,
  ) {
    // 1. 生成音频
    this.updateTask(taskId, { status: 'processing', message: '正在生成音频...' });
    const audioFileName = await this.generateAudio(text, referenceAudio, referenceText);

    // 2. 提交视频合成
    this.updateTask(taskId, { message: '正在合成视频...' });
    const { code } = await this.submitVideoTask(audioFileName, modelVideoPath);

    // 3. 轮询进度
    await this.pollVideoProgress(taskId, code);
  }

  private async pollVideoProgress(taskId: string, videoCode: string) {
    const maxAttempts = 300; // 最多等10分钟
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      try {
        const result = await this.queryVideoProgress(videoCode);

        if (result.code === 10000 && result.data) {
          if (result.data.status === 1) {
            // 处理中
            this.updateTask(taskId, {
              message: `视频合成中... ${result.data.progress || ''}`,
              progress: result.data.progress,
            });
          } else if (result.data.status === 2) {
            // 成功
            this.updateTask(taskId, {
              status: 'success',
              message: '视频生成完成',
              progress: 100,
              videoUrl: result.data.result,
            });
            return;
          } else if (result.data.status === 3) {
            // 失败
            this.updateTask(taskId, {
              status: 'failed',
              message: result.data.msg || '视频合成失败',
            });
            return;
          }
        } else if ([9999, 10002, 10003].includes(result.code)) {
          this.updateTask(taskId, {
            status: 'failed',
            message: result.msg || '视频合成失败',
          });
          return;
        }
      } catch (err) {
        this.logger.warn(`查询进度失败 (attempt ${attempts}): ${err.message}`);
      }
    }

    this.updateTask(taskId, { status: 'failed', message: '视频合成超时' });
  }

  private updateTask(taskId: string, updates: Partial<VideoTask>) {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, ...updates });
    }
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): VideoTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): VideoTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * 检查 Duix-Avatar 服务是否在线
   */
  async checkHealth(): Promise<{ tts: boolean; f2f: boolean }> {
    let tts = false;
    let f2f = false;

    try {
      await firstValueFrom(
        this.httpService.get(`${this.ttsUrl}/docs`, { timeout: 3000 }),
      );
      tts = true;
    } catch {}

    try {
      await firstValueFrom(
        this.httpService.get(`${this.f2fUrl}/easy/query?code=health-check`, { timeout: 3000 }),
      );
      f2f = true;
    } catch {}

    return { tts, f2f };
  }
}
