import { Injectable } from '@nestjs/common';
import { DetectResult, TranslateResult } from './translation.interface';
import { BaiduTranslationProvider } from './providers/baidu.provider';
import { AppLogger } from '../../common/logger/app-logger.service';

@Injectable()
export class TranslationService {
  private readonly logger: AppLogger;

  constructor(
    private readonly provider: BaiduTranslationProvider,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(TranslationService.name);
  }

  async detect(text: string): Promise<DetectResult> {
    return this.provider.detect(text);
  }

  // 百度翻译语言代码映射（将标准代码映射到百度API支持的代码）
  // https://fanyi-api.baidu.com/doc/21
  // 支持的语言：中文、英语、日语、韩语、西班牙语、法语、德语、俄语
  private mapToBaiduLangCode(langCode: string): string {
    const langMap: Record<string, string> = {
      zh: 'zh', // 中文
      en: 'en', // 英语
      ja: 'jp', // 日语（ISO: ja -> 百度: jp）
      jp: 'jp', // 日语（百度格式）
      ko: 'kor', // 韩语（ISO: ko -> 百度: kor）
      kor: 'kor', // 韩语（百度格式）
      es: 'spa', // 西班牙语（ISO: es -> 百度: spa）
      spa: 'spa', // 西班牙语（百度格式）
      fr: 'fra', // 法语（ISO: fr -> 百度: fra）
      fra: 'fra', // 法语（百度格式）
      de: 'de', // 德语
      ru: 'ru', // 俄语
      auto: 'auto', // 自动检测
    };

    const mappedCode = langMap[langCode.toLowerCase()];
    if (!mappedCode) {
      this.logger.warn(`Unsupported language code: ${langCode}, using 'auto'`);
      return 'auto';
    }

    return mappedCode;
  }

  async translate(
    text: string,
    to: string,
    from: string = 'auto',
  ): Promise<TranslateResult> {
    // 映射语言代码
    const mappedTo = this.mapToBaiduLangCode(to);
    const mappedFrom = this.mapToBaiduLangCode(from);

    this.logger.debug(
      `Translating: ${from} (${mappedFrom}) -> ${to} (${mappedTo})`,
    );

    return this.provider.translate(text, mappedTo, mappedFrom);
  }
}
