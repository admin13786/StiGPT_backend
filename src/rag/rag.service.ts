import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RetrievalService } from './retrieval.service';
import { LlmService } from './llm.service';
import { QueryDto, QueryResponseDto, CitationDto } from './dto/query.dto';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private prisma: PrismaService,
    private retrievalService: RetrievalService,
    private llmService: LlmService,
  ) {}

  /**
   * RAG 查询主流程
   */
  async query(dto: QueryDto, userId: string): Promise<QueryResponseDto> {
    const startTime = Date.now();

    try {
      this.logger.log(`RAG query: "${dto.query}" in kb ${dto.kbId}`);

      // 1. 检查知识库权限
      const hasAccess = await this.retrievalService.checkKbAccess(dto.kbId, userId);
      if (!hasAccess) {
        throw new ForbiddenException('无权访问此知识库');
      }

      // 2. 检索相关文档块
      const topK = dto.topK || 5;
      const retrievalResults = await this.retrievalService.hybridSearch(
        dto.kbId,
        dto.query,
        topK,
      );

      if (retrievalResults.length === 0) {
        this.logger.warn(`No relevant documents found for query in kb ${dto.kbId}`);
        return this.buildEmptyResponse(startTime);
      }

      // 3. 构建 Prompt
      const contexts = retrievalResults.map(r => r.content);
      const messages = this.llmService.buildRagPrompt(dto.query, contexts);

      // 4. 调用 LLM 生成答案
      const temperature = dto.temperature ?? 0.7;
      const llmResponse = await this.llmService.generate(messages, temperature);

      // 5. 提取引用
      const citedIndices = this.llmService.extractCitations(llmResponse.answer);
      const citations: CitationDto[] = citedIndices
        .map(idx => {
          const result = retrievalResults[idx - 1]; // 索引从 1 开始
          if (!result) return null;
          return {
            chunkId: result.chunkId,
            documentId: result.documentId,
            documentTitle: result.documentTitle,
            content: result.content,
            score: result.score,
            chunkIndex: result.chunkIndex,
          };
        })
        .filter(c => c !== null) as CitationDto[];

      // 6. 记录引用（用于分析）
      await this.recordCitations(dto.kbId, dto.sessionId, citations);

      // 7. 构建响应
      const processingTime = Date.now() - startTime;
      this.logger.log(`RAG query completed in ${processingTime}ms`);

      return {
        answer: llmResponse.answer,
        citations,
        retrievedCount: retrievalResults.length,
        tokenUsage: llmResponse.tokenUsage,
        processingTime,
      };
    } catch (error) {
      this.logger.error('RAG query failed', error);
      throw error;
    }
  }

  /**
   * 流式 RAG 查询
   */
  async *queryStream(dto: QueryDto, userId: string): AsyncGenerator<string> {
    try {
      this.logger.log(`RAG query (stream): "${dto.query}" in kb ${dto.kbId}`);

      // 1. 检查权限
      const hasAccess = await this.retrievalService.checkKbAccess(dto.kbId, userId);
      if (!hasAccess) {
        throw new ForbiddenException('无权访问此知识库');
      }

      // 2. 检索
      const topK = dto.topK || 5;
      const retrievalResults = await this.retrievalService.hybridSearch(
        dto.kbId,
        dto.query,
        topK,
      );

      if (retrievalResults.length === 0) {
        yield JSON.stringify({ type: 'error', message: '未找到相关文档' });
        return;
      }

      // 3. 发送引用信息
      const citations: CitationDto[] = retrievalResults.map(r => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentTitle: r.documentTitle,
        content: r.content,
        score: r.score,
        chunkIndex: r.chunkIndex,
      }));

      yield JSON.stringify({ type: 'citations', data: citations });

      // 4. 构建 Prompt
      const contexts = retrievalResults.map(r => r.content);
      const messages = this.llmService.buildRagPrompt(dto.query, contexts);

      // 5. 流式生成答案
      const temperature = dto.temperature ?? 0.7;
      for await (const chunk of this.llmService.generateStream(messages, temperature)) {
        yield JSON.stringify({ type: 'content', data: chunk });
      }

      // 6. 发送完成信号
      yield JSON.stringify({ type: 'done' });

      // 7. 记录引用
      await this.recordCitations(dto.kbId, dto.sessionId, citations);
    } catch (error) {
      this.logger.error('RAG query stream failed', error);
      yield JSON.stringify({ type: 'error', message: error.message });
    }
  }

  /**
   * 记录引用（用于分析）
   */
  private async recordCitations(
    kbId: string,
    sessionId: string | undefined,
    citations: CitationDto[],
  ): Promise<void> {
    try {
      if (citations.length === 0) return;

      const records = citations.map(c => ({
        kbId,
        documentId: c.documentId,
        chunkId: c.chunkId,
        sessionId: sessionId || '',
        messageId: '', // 暂时为空，后续可以传入实际的 messageId
        score: c.score,
        relevanceScore: c.score,
      }));

      await this.prisma.citation.createMany({
        data: records,
      });

      this.logger.log(`Recorded ${citations.length} citations`);
    } catch (error) {
      // 记录失败不影响主流程
      this.logger.error('Failed to record citations', error);
    }
  }

  /**
   * 构建空响应（未找到相关文档时）
   */
  private buildEmptyResponse(startTime: number): QueryResponseDto {
    return {
      answer: '抱歉，我在知识库中没有找到与您问题相关的内容。请尝试换一种方式提问，或者确认知识库中是否包含相关文档。',
      citations: [],
      retrievedCount: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * 获取知识库的热门引用
   */
  async getPopularCitations(kbId: string, limit: number = 10) {
    // 使用原始查询代替 groupBy
    const citations = await this.prisma.$queryRaw<any[]>`
      SELECT 
        "documentId",
        "chunkId",
        COUNT(*) as "citationCount"
      FROM "Citation"
      WHERE "kbId" = ${kbId}
      GROUP BY "documentId", "chunkId"
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `;

    // 获取文档详情
    const documentIds = [...new Set(citations.map(c => c.documentId))];
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: documentIds },
      },
      select: {
        id: true,
        title: true,
      },
    });

    const docMap = new Map(documents.map(d => [d.id, d.title]));

    return citations.map((c: any) => ({
      documentId: c.documentId,
      documentTitle: docMap.get(c.documentId) || 'Unknown',
      chunkId: c.chunkId,
      citationCount: parseInt(c.citationCount),
    }));
  }

  /**
   * 获取引用统计
   */
  async getCitationStats(kbId: string) {
    const [totalCitations, uniqueDocumentsResult, recentCitations] = await Promise.all([
      this.prisma.citation.count({ where: { kbId } }),
      this.prisma.$queryRaw<any[]>`
        SELECT COUNT(DISTINCT "documentId") as count
        FROM "Citation"
        WHERE "kbId" = ${kbId}
      `,
      this.prisma.citation.findMany({
        where: { kbId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const uniqueDocuments = uniqueDocumentsResult[0]?.count || 0;

    return {
      totalCitations,
      uniqueDocuments: parseInt(uniqueDocuments),
      recentCitations: recentCitations.map(c => ({
        id: c.id,
        documentId: c.documentId,
        chunkId: c.chunkId,
        score: c.score,
        relevanceScore: c.relevanceScore,
        createdAt: c.createdAt,
      })),
    };
  }
}
