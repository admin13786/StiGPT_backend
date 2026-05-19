/**
 * 阿里云 TTS 服务
 * 使用 DashScope API 进行文字转语音
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AliyunTtsService {
    private readonly apiKey: string;

    constructor(private configService: ConfigService) {
        this.apiKey = this.configService.get<string>('ALIYUN_API_KEY') || '';
    }

    /**
     * 文字转语音 - 使用异步 API
     * @param text 要转换的文字
     * @param voice 音色
     * @returns 音频 Buffer
     */
    async synthesize(text: string, voice: string = 'longxiaochun'): Promise<Buffer> {
        try {
            console.log('TTS 请求:', text.substring(0, 50), '音色:', voice);

            // 1. 提交异步任务
            const taskResponse = await axios.post(
                'https://dashscope.aliyuncs.com/api/v1/services/audio/tts',
                {
                    model: 'cosyvoice-v1',
                    input: {
                        text: text,
                    },
                    parameters: {
                        voice: voice,
                        format: 'mp3',
                        sample_rate: 22050,
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

            const taskId = taskResponse.data?.output?.task_id;
            if (!taskId) {
                throw new Error('未返回任务ID');
            }

            console.log('TTS 任务已提交:', taskId);

            // 2. 轮询查询结果
            const audioUrl = await this.waitForTaskComplete(taskId);

            // 3. 下载音频文件
            const audioResponse = await axios.get(audioUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
            });

            console.log('TTS 成功, 音频大小:', audioResponse.data.byteLength, 'bytes');
            return Buffer.from(audioResponse.data);
        } catch (error: any) {
            console.error('阿里云 TTS 错误:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * 轮询查询任务状态
     */
    private async waitForTaskComplete(taskId: string): Promise<string> {
        const maxAttempts = 30;
        const interval = 1000;

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
            console.log(`TTS 任务状态 [${i + 1}/${maxAttempts}]:`, status);

            if (status === 'SUCCEEDED') {
                const audioUrl = response.data?.output?.audio_url;
                if (!audioUrl) {
                    throw new Error('任务成功但未返回音频 URL');
                }
                return audioUrl;
            } else if (status === 'FAILED') {
                throw new Error('TTS 任务失败');
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('TTS 任务超时');
    }
}
