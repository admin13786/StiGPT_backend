import { Injectable, Logger } from '@nestjs/common';
import { RetrievalService, RetrievalResult } from './retrieval.service';
import { RerankService, RerankCandidate } from './rerank.service';
import { LightragService } from './lightrag.service';
import { SqlAgentService, SqlAgentResult } from './sql-agent.service';
import { LlmService } from './llm.service';

export interface DualRouteResult {
  answer: string;
  citations: Array<{ index: number; source: string; content: string }>;
  sources: {
    sql: SqlAgentResult;
    vector: RetrievalResult[];
    lightrag: string;
  };
  tokenUsage?: { prompt: number; completion: number; total: number };
}

@Injectable()
export class DualRouteService {
  private readonly logger = new Logger(DualRouteService.name);

  constructor(
    private retrievalService: RetrievalService,
    private rerankService: RerankService,
    private lightragService: LightragService,
    private sqlAgentService: SqlAgentService,
    private llmService: LlmService,
  ) {}

  /**
   * 双路检索 + AT-RAFT 两阶段精排 + 可解释生成
   *
   * 路线1: SQL Agent → PostgreSQL 结构化数据
   * 路线2a: Milvus 向量检索
   * 路线2b: LightRAG 图谱检索
   * → Reranker 精排 → LLM 生成带引用的答案
   */
  async query(question: string, kbId?: string): Promise<DualRouteResult> {
    this.logger.log(`双路检索开始: "${question.slice(0, 50)}..."`);

    // ===== AT-RAFT 第一阶段：三路并行粗检索 =====
    const [sqlResult, vectorResult, lightragResult] = await Promise.all([
      this.sqlAgentService.queryBySQL(question),
      kbId
        ? this.retrievalService.vectorSearch(kbId, question, 50)
        : Promise.resolve([] as RetrievalResult[]),
      this.lightragService.query(question, 'hybrid'),
    ]);

    // 合并候选集
    const candidates = this.mergeCandidates(sqlResult, vectorResult, lightragResult);

    if (candidates.length === 0 && !lightragResult) {
      // 没有任何检索结果，直接让 LLM 回答
      const directAnswer = await this.llmService.generate([
        { role: 'system', content: '你是科研助手。请根据你的知识回答问题。' },
        { role: 'user', content: question },
      ]);
      return {
        answer: directAnswer.answer,
        citations: [],
        sources: { sql: sqlResult, vector: vectorResult, lightrag: lightragResult },
        tokenUsage: directAnswer.tokenUsage,
      };
    }

    // ===== AT-RAFT 第二阶段：Reranker 精排 =====
    const reranked = await this.rerankService.rerank(question, candidates, 5);

    // ===== 可解释生成（强制 [1][2] 引用标注）=====
    const contexts: string[] = [];
    if (sqlResult.summary) contexts.push(`[数据库查询] ${sqlResult.summary}`);
    reranked.forEach((r, i) => contexts.push(`[${contexts.length + 1}] ${r.content}`));
    if (lightragResult) contexts.push(`[知识图谱] ${lightragResult}`);

    const messages = this.llmService.buildRagPrompt(question, contexts);
    const response = await this.llmService.generate(messages);

    // 提取引用
    const citations = this.extractCitations(response.answer, reranked);

    this.logger.log(`双路检索完成: SQL=${sqlResult.data.length}条, 向量=${vectorResult.length}条, LightRAG=${lightragResult ? '有' : '无'}`);

    return {
      answer: response.answer,
      citations,
      sources: { sql: sqlResult, vector: vectorResult, lightrag: lightragResult },
      tokenUsage: response.tokenUsage,
    };
  }

  /**
   * 合并三路检索结果为统一候选集
   */
  private mergeCandidates(
    sqlResult: SqlAgentResult,
    vectorResult: RetrievalResult[],
    lightragResult: string,
  ): RerankCandidate[] {
    const candidates: RerankCandidate[] = [];

    // SQL 结果转为文本候选
    if (sqlResult.summary) {
      candidates.push({
        id: 'sql-summary',
        content: sqlResult.summary,
        documentTitle: 'SQL查询结果',
        score: 0.8,
      });
    }

    // 向量检索结果
    for (const r of vectorResult) {
      candidates.push({
        id: r.chunkId,
        content: r.content,
        documentTitle: r.documentTitle,
        score: r.score,
        metadata: r.metadata,
      });
    }

    return candidates;
  }

  /**
   * 从答案中提取引用标注
   */
  private extractCitations(
    answer: string,
    reranked: RerankCandidate[],
  ): Array<{ index: number; source: string; content: string }> {
    const citationNums = this.llmService.extractCitations(answer);
    return citationNums
      .filter(n => n > 0 && n <= reranked.length)
      .map(n => ({
        index: n,
        source: reranked[n - 1]?.documentTitle || '',
        content: reranked[n - 1]?.content?.slice(0, 200) || '',
      }));
  }
}