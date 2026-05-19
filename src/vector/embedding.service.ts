import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey = process.env.ALIYUN_API_KEY;
  private readonly model = process.env.ALIYUN_EMBEDDING_MODEL || 'text-embedding-v2';
  private readonly endpoint = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';

  async embed(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        this.endpoint,
        {
          model: this.model,
          input: {
            texts: [text],
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      if (response.data.output && response.data.output.embeddings) {
        return response.data.output.embeddings[0].embedding;
      }

      throw new Error('Invalid response from embedding service');
    } catch (error) {
      this.logger.error('Failed to generate embedding', error.message);
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 阿里云限制每次最多25个
    const batchSize = 25;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      try {
        const response = await axios.post(
          this.endpoint,
          {
            model: this.model,
            input: {
              texts: batch,
            },
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        );

        if (response.data.output && response.data.output.embeddings) {
          const embeddings = response.data.output.embeddings.map(e => e.embedding);
          results.push(...embeddings);
          this.logger.log(`Generated ${embeddings.length} embeddings (batch ${Math.floor(i / batchSize) + 1})`);
        } else {
          throw new Error('Invalid response from embedding service');
        }

        // 避免请求过快
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.logger.error(`Failed to generate embeddings for batch ${Math.floor(i / batchSize) + 1}`, error.message);
        throw error;
      }
    }

    return results;
  }

  estimateTokens(text: string): number {
    // 简单估算：中文按字符数，英文按单词数
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + Math.ceil(englishWords / 0.75); // 英文约0.75个token/词
  }
}
