import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  DetectResult,
  TranslateResult,
  TranslationProvider,
} from '../translation.interface';
import { AppLogger } from '../../../common/logger/app-logger.service';

@Injectable()
export class BaiduTranslationProvider implements TranslationProvider {
  private readonly logger: AppLogger;
  private readonly appId: string;
  private readonly secret: string;
  private readonly apiUrl =
    'https://fanyi-api.baidu.com/api/trans/vip/translate';

  constructor(
    private readonly configService: ConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(BaiduTranslationProvider.name);

    const rawAppId =
      this.configService.get<string>('BAIDU_TRANSLATE_APP_ID') || '';
    const rawSecret =
      this.configService.get<string>('BAIDU_TRANSLATE_SECRET') || '';

    this.logger.debug('[Baidu Translation Provider Initialization]');
    this.logger.debug(
      `  Raw App ID configured: ${rawAppId ? 'yes' : 'no'} (length: ${rawAppId.length})`,
    );
    this.logger.debug(
      `  Raw Secret configured: ${rawSecret ? 'yes' : 'no'} (length: ${rawSecret.length})`,
    );

    this.appId = rawAppId
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[\r\n\t]/g, '');
    this.secret = rawSecret
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/[\r\n\t]/g, '');

    this.logger.debug(
      `  Cleaned App ID configured: ${this.appId ? 'yes' : 'no'} (length: ${this.appId.length})`,
    );
    this.logger.debug(
      `  Cleaned Secret configured: ${this.secret ? 'yes' : 'no'} (length: ${this.secret.length})`,
    );

    if (this.secret && /^\*+$/.test(this.secret)) {
      this.logger.error(
        'Baidu Translate secret is still a placeholder made of asterisks.',
      );
      this.logger.error(
        'Replace BAIDU_TRANSLATE_SECRET=******************** with a real value in .env.',
      );
      this.logger.error(
        'Expected format: BAIDU_TRANSLATE_SECRET=replace-with-baidu-secret',
      );
    }

    if (!this.appId || !this.secret) {
      this.logger.error('Baidu Translate API credentials are missing.');
      this.logger.error(
        `  App ID configured: ${this.appId ? 'yes' : 'no'} (length: ${this.appId.length})`,
      );
      this.logger.error(
        `  Secret configured: ${this.secret ? 'yes' : 'no'} (length: ${this.secret.length})`,
      );
      this.logger.error(
        '  Required env vars: BAIDU_TRANSLATE_APP_ID=replace-with-baidu-app-id',
      );
      this.logger.error(
        '  Required env vars: BAIDU_TRANSLATE_SECRET=replace-with-baidu-secret',
      );
      return;
    }

    this.logger.debug('Baidu Translate API configured successfully');
    this.logger.debug(`  Secret length: ${this.secret.length}`);

    if (this.secret.length !== 20) {
      this.logger.warn(
        `Warning: Secret length is ${this.secret.length}, expected 20. This may cause signature errors.`,
      );
    }

    if (!/^[a-zA-Z0-9]+$/.test(this.secret)) {
      const invalidChars = this.secret
        .split('')
        .filter((c) => !/^[a-zA-Z0-9]$/.test(c));
      this.logger.warn(
        `Warning: Secret contains non-alphanumeric characters: ${invalidChars.map((c) => `'${c}' (${c.charCodeAt(0)})`).join(', ')}`,
      );
    }

    if (this.secret.length < 8) {
      this.logger.warn(
        'Warning: Secret appears unusually short. Verify BAIDU_TRANSLATE_SECRET in your environment.',
      );
    }
  }

  private sign(q: string, salt: string): string {
    const query = String(q || '');

    if (!this.appId || !this.secret) {
      throw new Error('Baidu Translate API credentials are not configured');
    }

    const str = this.appId + query + salt + this.secret;
    const sign = crypto.createHash('md5').update(str, 'utf8').digest('hex');

    this.logger.debug('[Sign Calculation]');
    this.logger.debug(
      `  query length: ${query.length}, query bytes: ${Buffer.from(query, 'utf8').length}`,
    );
    this.logger.debug(`  salt: "${salt}"`);
    this.logger.debug(`  secret length: ${this.secret.length}`);
    this.logger.debug(
      `  sign string length: ${str.length}, sign string bytes: ${Buffer.from(str, 'utf8').length}`,
    );

    return sign;
  }

  async detect(text: string): Promise<DetectResult> {
    try {
      const res = await this.translate(text, 'en', 'auto');
      return {
        language: res.sourceLanguage,
        confidence: 0.8,
      };
    } catch (error) {
      this.logger.error('Detection failed', error);
      return { language: 'auto', confidence: 0 };
    }
  }

  async translate(
    text: string,
    to: string,
    from: string = 'auto',
  ): Promise<TranslateResult> {
    if (!text) {
      return {
        content: '',
        sourceLanguage: from,
        targetLanguage: to,
        provider: 'baidu',
      };
    }

    const salt = Date.now().toString();

    try {
      if (!this.appId || !this.secret) {
        this.logger.error(
          'Baidu Translate API credentials are missing! Cannot translate.',
        );
        throw new Error('Baidu Translate API credentials are not configured');
      }

      this.logger.debug(
        `Translating text (length: ${text.length}) from ${from} to ${to}`,
      );

      const sign = this.sign(text, salt);

      this.logger.debug('[Request Parameters]');
      this.logger.debug(`  q length: ${text.length}`);
      this.logger.debug(`  from: ${from}`);
      this.logger.debug(`  to: ${to}`);
      this.logger.debug(`  salt: ${salt}`);

      const response = await axios.get(this.apiUrl, {
        params: {
          q: text,
          from,
          to,
          appid: this.appId,
          salt,
          sign,
        },
        timeout: 30000,
      });

      const data = response.data;

      this.logger.debug(
        `[API Response] ${JSON.stringify(data).substring(0, 200)}`,
      );

      if (data.error_code) {
        this.logger.error(
          `Baidu Translation Error: ${data.error_code} - ${data.error_msg}`,
        );

        let errorMessage = data.error_msg;
        switch (data.error_code) {
          case 54001:
            errorMessage =
              `Signature error (${data.error_msg}). Please verify:\n` +
              `1. BAIDU_TRANSLATE_APP_ID is configured correctly (length: ${this.appId.length})\n` +
              `2. BAIDU_TRANSLATE_SECRET is configured correctly (length: ${this.secret.length}, expected: 20)\n` +
              `3. Both env vars are loaded from the active environment\n` +
              `4. The secret contains only letters and numbers with no hidden spaces`;
            this.logger.error('[Signature Error Diagnosis]');
            this.logger.error(
              `  App ID configured: ${this.appId ? 'yes' : 'no'} (length: ${this.appId.length})`,
            );
            this.logger.error(
              `  Secret length: ${this.secret.length} (expected: 20)`,
            );
            this.logger.error(
              `  Secret format valid: ${/^[a-zA-Z0-9]+$/.test(this.secret)}`,
            );
            this.logger.error(
              '  Hint: verify BAIDU_TRANSLATE_APP_ID and BAIDU_TRANSLATE_SECRET in the active .env.',
            );
            break;
          case 54003:
            errorMessage = `Access frequency limited (${data.error_msg}). Please retry later.`;
            break;
          case 54004:
            errorMessage = `Insufficient account balance (${data.error_msg}).`;
            break;
          case 54005:
            errorMessage = `Too many requests (${data.error_msg}). Please retry later.`;
            break;
        }

        throw new Error(`Translation failed: ${errorMessage}`);
      }

      if (
        !data.trans_result ||
        !Array.isArray(data.trans_result) ||
        data.trans_result.length === 0
      ) {
        throw new Error('Translation failed: No translation result returned');
      }

      const dst = data.trans_result.map((item: any) => item.dst).join('\n');
      const src = data.trans_result[0].src || from;

      this.logger.log(
        `Translation success: ${from} -> ${to} (${text.length} chars)`,
      );

      return {
        content: dst,
        sourceLanguage: src,
        targetLanguage: to,
        provider: 'baidu',
      };
    } catch (error: any) {
      this.logger.error(`Baidu Translation Request Failed: ${error.message}`);
      this.logger.error(
        `Error details: ${error.response?.data?.error_msg || error.message}`,
      );

      if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message.includes('timeout')
      ) {
        this.logger.warn(
          'Network connection failed, using mock translation as fallback.',
        );
        this.logger.warn(
          'Check network connectivity or HTTP_PROXY/HTTPS_PROXY settings.',
        );
        return {
          content: `[network unavailable] ${text}`,
          sourceLanguage: from === 'auto' ? 'zh' : from,
          targetLanguage: to,
          provider: 'mock-network-error',
        };
      }

      if (
        error.message.includes('service close') ||
        error.response?.data?.error_code === 58002
      ) {
        this.logger.warn('Using mock translation due to service closure');
        return {
          content: `[MockData] ${text}`,
          sourceLanguage: from === 'auto' ? 'en' : from,
          targetLanguage: to,
          provider: 'mock',
        };
      }

      throw error;
    }
  }
}
