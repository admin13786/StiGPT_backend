import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RerankCandidate {
  id?: string;
  content: string;
  documentTitle?: string;
  score?: number;
  metadata?: any;
}

export interface RerankResult extends RerankCandidate {
  rerankScore: number;
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ALIYUN_API_KEY') || '';
    this.model = this.configService.get<string>('RERANK_MODEL', 'gte-rerank');
  }

  /**
   * AT-RAFT 第二阶段：Reranker 精排
   * 使用阿里云 gte-rerank 对候选集重排序
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topK: number = 5,
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];
    if (candidates.length <= topK) {
      return candidates.map(c => ({ ...c, rerankScore: c.score || 0 }));
    }

    try {
      const documents = candidates.map(c => c.content);

      const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
        {
          model: this.model,
          input: { query, documents },
          parameters: { top_n: topK, return_documents: false },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const results = response.data?.output?.results || [];

      return results.map((r: any) => ({
        ...candidates[r.index],
        rerankScore: r.relevance_score,
      }));
    } catch (error) {
      this.logger.warn('Reranker API 调用失败，降级为按原始分数排序', error.message);
      // 降级：按原始分数排序
      return candidates
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topK)
        .map(c => ({ ...c, rerankScore: c.score || 0 }));
    }
  }
}