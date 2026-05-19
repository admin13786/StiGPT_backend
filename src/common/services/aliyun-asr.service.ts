/**
 * 阿里云语音识别服务
 * 使用 DashScope API 进行语音转文字
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';

@Injectable()
export class AliyunAsrService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ALIYUN_API_KEY') || '';
  }

  /**
   * 语音识别 - 通过文件路径识别音频文件（使用同步 API）
   * @param filePath 音频文件的本地路径
   * @returns 识别的文字
   */
  async transcribeFromFile(filePath: string): Promise<string> {
    try {
      // 读取音频文件并转换为 base64
      const audioBuffer = fs.readFileSync(filePath);
      const audioBase64 = audioBuffer.toString('base64');

      // 根据文件扩展名检测格式
      const ext = filePath.split('.').pop()?.toLowerCase() || 'wav';
      const formatMap: { [key: string]: string } = {
        'wav': 'wav',
        'webm': 'webm',
        'mp3': 'mp3',
        'ogg': 'ogg',
        'opus': 'opus',
        'm4a': 'm4a',
        'flac': 'flac',
      };
      const format = formatMap[ext] || 'wav';

      console.log('音频文件大小:', audioBuffer.length, 'bytes', '格式:', format);

      // 使用同步 API 进行识别
      const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/paraformer-v2',
        {
          model: 'paraformer-v2',
          input: {
            audio: audioBase64,
          },
          parameters: {
            format: format,
            sample_rate: 16000,
            language_hints: ['zh', 'en'],
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      console.log('识别响应:', JSON.stringify(response.data, null, 2));

      // 解析结果
      if (response.data?.output?.results?.[0]?.transcription?.text) {
        return response.data.output.results[0].transcription.text;
      }

      throw new Error('识别成功但未返回文字');
    } catch (error: any) {
      console.error('阿里云语音识别错误:', error.response?.data || error.message);
      throw new Error(`语音识别失败: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * 语音识别 - 通过 URL 识别音频文件（保留用于公网 URL）
   * @param fileUrl 音频文件的 URL
   * @returns 识别的文字
   */
  async transcribeFromUrl(fileUrl: string): Promise<string> {
    try {
      // 提交任务
      const taskId = await this.submitTask(fileUrl);
      console.log('语音识别任务已提交:', taskId);

      // 轮询查询结果
      const result = await this.waitForComplete(taskId);

      return result;
    } catch (error: any) {
      console.error('阿里云语音识别错误:', error.response?.data || error.message);
      throw new Error(`语音识别失败: ${error.response?.data?.message || error.message}`);
    }
  }



  /**
   * 提交语音识别任务 - 使用 URL
   */
  private async submitTask(fileUrl: string): Promise<string> {
    const response = await axios.post(
      this.apiUrl,
      {
        model: 'paraformer-v2',
        input: {
          file_urls: [fileUrl],
        },
        parameters: {
          language_hints: ['zh', 'en'],
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        timeout: 30000,
      }
    );

    if (response.data?.output?.task_id) {
      return response.data.output.task_id;
    }

    throw new Error('提交任务失败：未返回任务ID');
  }

  /**
   * 轮询查询任务结果
   */
  private async waitForComplete(taskId: string): Promise<string> {
    const maxAttempts = 60; // 最多尝试 60 次
    const interval = 1000; // 每次间隔 1 秒

    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      const status = response.data?.output?.task_status;

      if (status === 'SUCCEEDED') {
        // 获取识别结果
        const results = response.data?.output?.results;
        if (results && results.length > 0) {
          const transcriptionUrl = results[0].transcription_url;

          // 下载识别结果
          const transcription = await axios.get(transcriptionUrl);
          const text = transcription.data?.transcripts?.[0]?.text;

          if (text) {
            return text;
          }
        }
        throw new Error('识别成功但未返回文字');
      } else if (status === 'FAILED') {
        throw new Error('识别任务失败');
      }

      // 等待后继续查询
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error('识别超时');
  }

  /**
   * 实时语音识别（WebSocket 方式）
   * 注意：这个需要 WebSocket 连接，暂时不实现
   */
  async transcribeRealtime(audioStream: any): Promise<string> {
    throw new Error('实时语音识别暂未实现');
  }
}
