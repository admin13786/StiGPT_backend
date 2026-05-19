export interface DetectResult {
  language: string; // ISO 639-1 code (e.g., 'en', 'zh')
  confidence?: number; // 0.0 - 1.0 (Baidu does not return confidence, we might default to 1.0)
}

export interface TranslateResult {
  content: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string; // 'baidu'
}

export interface TranslationProvider {
  detect(text: string): Promise<DetectResult>;
  translate(text: string, to: string, from?: string): Promise<TranslateResult>;
}
