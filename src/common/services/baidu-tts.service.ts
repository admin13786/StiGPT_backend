/**
 * 百度智能云 TTS 服务
 * 使用百度 AI 开放平台进行文字转语音
 * 免费额度：每天 5万次
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class BaiduTtsService {
    private readonly apiKey: string;
    private readonly secretKey: string;
    private accessToken: string = '';
    private tokenExpireTime: number = 0;

    constructor(private configService: ConfigService) {
        this.apiKey = this.configService.get<string>('BAIDU_TTS_API_KEY') || '';
        this.secretKey = this.configService.get<string>('BAIDU_TTS_SECRET_KEY') || '';
    }

    /**
     * 文字转语音
     * @param text 要转换的文字
     * @param voice 音色，默认 0（度小美-女声）
     * @returns 音频 Buffer
     */
    async synthesize(text: string, voice: number = 0): Promise<Buffer> {
        try {
            console.log('百度 TTS 请求:', text.substring(0, 50), '音色:', voice);

            // 获取 access_token
            const token = await this.getAccessToken();

            // 调用 TTS API
            const response = await axios.post(
                'https://tsn.baidu.com/text2audio',
                null,
                {
                    params: {
                        tex: text,
                        tok: token,
                        cuid: 'ai-digital-human',
                        ctp: 1,
                        lan: 'zh',
                        spd: 5,    // 语速：0-15，默认5
                        pit: 5,    // 音调：0-15，默认5
                        vol: 5,    // 音量：0-15，默认5
                        per: voice, // 音色：0-度小美，1-度小宇，3-度逍遥，4-度丫丫
                        aue: 3,    // 音频格式：3-mp3
                    },
                    responseType: 'arraybuffer',
                    timeout: 30000,
                }
            );

            // 检查是否返回错误（JSON格式）
            const contentType = response.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
                const errorText = Buffer.from(response.data).toString('utf-8');
                const errorJson = JSON.parse(errorText);
                throw new Error(`百度 TTS 错误: ${errorJson.err_msg || errorJson.error_msg}`);
            }

            const audioBuffer = Buffer.from(response.data);
            console.log('百度 TTS 成功, 音频大小:', audioBuffer.length, 'bytes');
            return audioBuffer;
        } catch (error: any) {
            console.error('百度 TTS 错误:', error.message);
            throw error;
        }
    }

    /**
     * 获取 access_token
     */
    private async getAccessToken(): Promise<string> {
        // 如果 token 还有效，直接返回
        const now = Date.now();
        if (this.accessToken && now < this.tokenExpireTime) {
            return this.accessToken;
        }

        try {
            console.log('获取百度 access_token...');
            
            const response = await axios.post(
                'https://aip.baidubce.com/oauth/2.0/token',
                null,
                {
                    params: {
                        grant_type: 'client_credentials',
                        client_id: this.apiKey,
                        client_secret: this.secretKey,
                    },
                    timeout: 10000,
                }
            );

            if (response.data.error) {
                throw new Error(`获取 token 失败: ${response.data.error_description}`);
            }

            this.accessToken = response.data.access_token;
            // token 有效期 30 天，提前 1 天刷新
            this.tokenExpireTime = now + (response.data.expires_in - 86400) * 1000;
            
            console.log('access_token 获取成功');
            return this.accessToken;
        } catch (error: any) {
            console.error('获取 access_token 失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取可用的音色列表
     */
    getAvailableVoices(): Array<{ name: string; value: number; gender: string; description: string }> {
        return [
            { name: '度小美', value: 0, gender: '女', description: '甜美女声' },
            { name: '度小宇', value: 1, gender: '男', description: '成熟男声' },
            { name: '度逍遥', value: 3, gender: '男', description: '磁性男声' },
            { name: '度丫丫', value: 4, gender: '女', description: '可爱童声' },
            { name: '度小娇', value: 5, gender: '女', description: '温柔女声' },
            { name: '度米朵', value: 103, gender: '女', description: '情感女声' },
            { name: '度博文', value: 106, gender: '男', description: '情感男声' },
            { name: '度小童', value: 110, gender: '女', description: '萌萌童声' },
            { name: '度小萌', value: 111, gender: '女', description: '活泼女声' },
            { name: '度米朵朵', value: 103, gender: '女', description: '温柔女声' },
        ];
    }
}
