export interface TranslationInfo {
  translatedContent: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string; // e.g., 'baidu', 'google'
  translatedAt: string; // ISO date string
}

export interface SessionMetadata {
  playerLanguage?: string; // e.g., 'en', 'zh', 'jp'
  languageDetectedAt?: string; // ISO date string
  languageConfidence?: number; // 0.0 - 1.0
  languageDetectionHistory?: Array<{
    messageId: string;
    language: string;
    confidence: number;
    detectedAt: string;
  }>;
  [key: string]: any; // Allow other properties
}

export interface MessageMetadata {
  translation?: TranslationInfo;
  suggestedOptions?: string[]; // For quick replies etc.
  [key: string]: any; // Allow other properties
}
