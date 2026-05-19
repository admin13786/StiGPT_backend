import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TranslationService } from './translation.service';
import { BaiduTranslationProvider } from './providers/baidu.provider';

@Module({
  imports: [ConfigModule],
  providers: [TranslationService, BaiduTranslationProvider],
  exports: [TranslationService],
})
export class TranslationModule {}
