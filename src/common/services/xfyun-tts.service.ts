/**
 * 科大讯飞 TTS 服务
 * 使用 WebAPI 进行文字转语音
 * 音质自然，支持多种中文音色
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class XfyunTtsService {
    private readonly appId: string;
    private readonly apiKey: string;
    private readonly apiSecret: string;

    constructor(private configService: ConfigService) {
        this.appId = this.configService.get<string>('XFYUN_APP_ID') || '';
        this.apiKey = this.configService.get<string>('XFYUN_API_KEY') || '';
        this.apiSecret = this.configService.get<string>('XFYUN_API_SECRET') || '';
    }

    /**
     * 文字转语音
     * @param text 要转换的文字
     * @param voice 音色，默认 xiaoyan（小燕-女声，温柔）
     * @returns 音频 Buffer
     */
    async synthesize(text: string, voice: string = 'xiaoyan'): Promise<Buffer> {
        try {
            console.log('科大讯飞 TTS 请求:', text.substring(0, 50), '音色:', voice);

            // 生成鉴权 URL
            const url = this.getAuthUrl();

            // 构建请求参数
            const params = {
                common: {
                    app_id: this.appId,
                },
                business: {
                    aue: 'lame',      // 音频编码：lame(mp3)
                    auf: 'audio/L16;rate=16000', // 音频采样率
                    vcn: voice,       // 音色
                    speed: 50,        // 语速：0-100，默认50
                    volume: 50,       // 音量：0-100，默认50
                    pitch: 50,        // 音调：0-100，默认50
                    bgs: 0,           // 背景音：0-无，1-有
                    tte: 'UTF8',      // 文本编码
                },
                data: {
                    status: 2,        // 数据状态：2-一次性传输
                    text: Buffer.from(text).toString('base64'),
                },
            };

            // 发送请求
            const response = await axios.post(url, params, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            // 检查响应
            if (response.data.code !== 0) {
                throw new Error(`科大讯飞 TTS 错误: ${response.data.message}`);
            }

            // 解析音频数据
            const audioBase64 = response.data.data.audio;
            const audioBuffer = Buffer.from(audioBase64, 'base64');

            console.log('科大讯飞 TTS 成功, 音频大小:', audioBuffer.length, 'bytes');
            return audioBuffer;
        } catch (error: any) {
            console.error('科大讯飞 TTS 错误:', error.message);
            throw error;
        }
    }

    /**
     * 生成鉴权 URL
     */
    private getAuthUrl(): string {
        const host = 'tts-api.xfyun.cn';
        const path = '/v2/tts';
        const date = new Date().toUTCString();

        // 生成签名
        const signatureOrigin = `host: ${host}\ndate: ${date}\nPOST ${path} HTTP/1.1`;
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(signatureOrigin)
            .digest('base64');

        // 生成 authorization
        const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
        const authorization = Buffer.from(authorizationOrigin).toString('base64');

        // 构建 URL
        return `https://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
    }

    /**
     * 获取可用的音色列表
     */
    getAvailableVoices(): Array<{ name: string; value: string; gender: string; description: string }> {
        return [
            { name: '小燕', value: 'xiaoyan', gender: '女', description: '温柔、亲切' },
            { name: '许久', value: 'aisjiuxu', gender: '男', description: '成熟、稳重' },
            { name: '小萍', value: 'aisxping', gender: '女', description: '知性、优雅' },
            { name: '小婧', value: 'aisjinger', gender: '女', description: '甜美、活泼' },
            { name: '小坤', value: 'aisbabyxu', gender: '男', description: '青春、阳光' },
            { name: '许小宝', value: 'aisxiaoxian', gender: '女', description: '可爱、童真' },
        ];
    }
}
