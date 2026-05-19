import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { DualRouteService, DualRouteResult } from './dual-route.service';

export interface SmartQueryResult extends DualRouteResult {
  retrievalUsed: boolean;
  qualityScore?: number;
  retried?: boolean;
}

@Injectable()
export class SelfRagService {
  private readonly logger = new Logger(SelfRagService.name);

  constructor(
    private llmService: LlmService,
    private dualRouteService: DualRouteService,
  ) {}

  /**
   * SELF-RAG 智能查询：判断是否需要检索 → 检索 → 自评质量 → 必要时重试
   */
  async smartQuery(question: string, kbId?: string): Promise<SmartQueryResult> {
    // 1. 判断是否需要检索
    const needRetrieval = await this.judgeNeedRetrieval(question);
    if (!needRetrieval) {
      const directAnswer = await this.llmService.generate([
        { role: 'system', content: '你是科研助手，请直接回答以下常识性问题。' },
        { role: 'user', content: question },
      ]);
      return {
        answer: directAnswer.answer,
        citations: [],
        sources: { sql: { data: [], sql: '', summary: '' }, vector: [], lightrag: '' },
        tokenUsage: directAnswer.tokenUsage,
        retrievalUsed: false,
      };
    }

    // 2. 执行双路检索
    const result = await this.dualRouteService.query(question, kbId);

    // 3. 自评答案质量
    const quality = await this.evaluateQuality(question, result.answer);
    this.logger.log(`答案质量评分: ${quality}`);

    if (quality < 0.6) {
      // 重写 query 重试
      this.logger.log('质量不足，重写查询重试');
      const reformulated = await this.reformulateQuery(question);
      const retryResult = await this.dualRouteService.query(reformulated, kbId);
      return { ...retryResult, retrievalUsed: true, qualityScore: quality, retried: true };
    }

    return { ...result, retrievalUsed: true, qualityScore: quality };
  }

  private async judgeNeedRetrieval(question: string): Promise<boolean> {
    try {
      const result = await this.llmService.generate([
        {
          role: 'system',
          content: '判断问题是否需要检索外部知识库。常识性问题回答"否"，专业/具体/需要数据支撑的问题回答"是"。只回答一个字："是"或"否"。',
        },
        { role: 'user', content: question },
      ], 0.1);
      return result.answer.includes('是');
    } catch {
      return true; // 出错时默认需要检索
    }
  }

  private async evaluateQuality(question: string, answer: string): Promise<number> {
    try {
      const result = await this.llmService.generate([
        {
          role: 'system',
          content: '评估答案质量（0-1分）。评估维度：相关性、完整性、准确性。只返回一个数字，如 0.85',
        },
        { role: 'user', content: `问题：${question}\n答案：${answer}` },
      ], 0.1);
      const score = parseFloat(result.answer.match(/[\d.]+/)?.[0] || '0.7');
      return Math.min(1, Math.max(0, score));
    } catch {
      return 0.7; // 出错时给默认分
    }
  }

  private async reformulateQuery(question: string): Promise<string> {
    try {
      const result = await this.llmService.generate([
        {
          role: 'system',
          content: '重写以下问题，使其更具体、更容易检索到相关信息。只返回重写后的问题。',
        },
        { role: 'user', content: question },
      ], 0.3);
      return result.answer;
    } catch {
      return question;
    }
  }
}