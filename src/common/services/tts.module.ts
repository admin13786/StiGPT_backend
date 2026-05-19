import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsController } from './tts.controller';
import { AliyunTtsService } from './aliyun-tts.service';
import { XfyunTtsService } from './xfyun-tts.service';
import { BaiduTtsService } from './baidu-tts.service';

@Module({
    imports: [ConfigModule],
    controllers: [TtsController],
    providers: [AliyunTtsService, XfyunTtsService, BaiduTtsService],
    exports: [AliyunTtsService, XfyunTtsService, BaiduTtsService],
})
export class TtsModule { }
