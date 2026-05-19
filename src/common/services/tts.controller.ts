import {
    Controller,
    Post,
    Body,
    Res,
    BadRequestException,
    Get,
} from '@nestjs/common';
import { Response } from 'express';
import { AliyunTtsService } from './aliyun-tts.service';
import { XfyunTtsService } from './xfyun-tts.service';
import { BaiduTtsService } from './baidu-tts.service';
import { Public } from '../../auth/decorators/public.decorator';

@Controller('tts')
export class TtsController {
    constructor(
        private readonly aliyunTtsService: AliyunTtsService,
        private readonly xfyunTtsService: XfyunTtsService,
        private readonly baiduTtsService: BaiduTtsService,
    ) { }

    @Public()
    @Post('synthesize')
    async synthesize(@Body() body: any, @Res() res: Response) {
        const text = body?.text;
        const voice = body?.voice || 0;

        if (!text || typeof text !== 'string') {
            throw new BadRequestException('缺少文本参数或格式不正确');
        }

        try {
            console.log('TTS 请求 (百度智能云):', { text: text.substring(0, 50), voice });

            // 使用百度 TTS（免费额度最大：5万次/天）
            const audioBuffer = await this.baiduTtsService.synthesize(text, voice);

            res.status(200);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Length', audioBuffer.length);
            res.send(audioBuffer);
        } catch (error: any) {
            console.error('TTS 错误:', error.message);
            throw new BadRequestException(error.message);
        }
    }

    @Public()
    @Get('voices')
    async getVoices() {
        return {
            success: true,
            voices: this.baiduTtsService.getAvailableVoices(),
        };
    }
}
