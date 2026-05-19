import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VectorService } from '../vector/vector.service';

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  chunkIndex: number;
  metadata?: any;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private prisma: PrismaService,
    private vectorService: VectorService,
  ) {}

  /**
   * 向量检索
   */
  async vectorSearch(
    kbId: string,
    query: string,
    topK: number = 5,
  ): Promise<RetrievalResult[]> {
    try {
      this.logger.log(`Vector search in kb ${kbId} with topK=${topK}`);

      // 1. 向量化查询
      const queryVector = await this.vectorService.embedText(query);

      // 2. 在 Milvus 中搜索
      const searchResults = await this.vectorService.searchVectors(kbId, [queryVector], topK);

      if (!searchResults || searchResults.length === 0) {
        this.logger.warn(`No results found for query in kb ${kbId}`);
        return [];
      }

      // 3. 获取文档块详细信息
      const chunkIds = searchResults[0].map(r => r.id);
      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          vectorId: { in: chunkIds },
        },
        include: {
          document: {
            select: {
              id: true,
              title: true,
              kbId: true,
            },
          },
        },
      });

      // 4. 构建结果
      const results: RetrievalResult[] = [];
      for (const searchResult of searchResults[0]) {
        const chunk = chunks.find(c => c.vectorId === searchResult.id);
        if (chunk) {
          results.push({
            chunkId: chunk.id,
            documentId: chunk.documentId,
            documentTitle: chunk.document.title,
            content: chunk.content,
            score: searchResult.score,
            chunkIndex: chunk.chunkIndex,
            metadata: chunk.metadata,
          });
        }
      }

      this.logger.log(`Retrieved ${results.length} chunks from vector search`);
      return results;
    } catch (error) {
      this.logger.error('Vector search failed', error);
      throw error;
    }
  }

  /**
   * 关键词检索（BM25 - 简化版）
   */
  async keywordSearch(
    kbId: string,
    query: string,
    topK: number = 5,
  ): Promise<RetrievalResult[]> {
    try {
      this.logger.log(`Keyword search in kb ${kbId}`);

      // 使用 PostgreSQL 全文搜索
      const chunks = await this.prisma.$queryRaw<any[]>`
        SELECT 
          dc.id as "chunkId",
          dc."documentId",
          d.title as "documentTitle",
          dc.content,
          dc."chunkIndex",
          dc.metadata,
          ts_rank(to_tsvector('simple', dc.content), plainto_tsquery('simple', ${query})) as score
        FROM "DocumentChunk" dc
        JOIN "Document" d ON dc."documentId" = d.id
        WHERE d."kbId" = ${kbId}
          AND d."deletedAt" IS NULL
          AND to_tsvector('simple', dc.content) @@ plainto_tsquery('simple', ${query})
        ORDER BY score DESC
        LIMIT ${topK}
      `;

      const results: RetrievalResult[] = chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        content: chunk.content,
        score: parseFloat(chunk.score),
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata,
      }));

      this.logger.log(`Retrieved ${results.length} chunks from keyword search`);
      return results;
    } catch (error) {
      this.logger.error('Keyword search failed', error);
      // 如果全文搜索失败，返回空结果而不是抛出错误
      return [];
    }
  }

  /**
   * 混合检索（向量 + 关键词）
   */
  async hybridSearch(
    kbId: string,
    query: string,
    topK: number = 5,
  ): Promise<RetrievalResult[]> {
    try {
      this.logger.log(`Hybrid search in kb ${kbId}`);

      // 1. 并行执行向量检索和关键词检索
      const [vectorResults, keywordResults] = await Promise.all([
        this.vectorSearch(kbId, query, topK * 2),
        this.keywordSearch(kbId, query, topK * 2),
      ]);

      // 2. 合并结果并去重
      const mergedMap = new Map<string, RetrievalResult>();

      // 向量检索结果权重 0.7
      for (const result of vectorResults) {
        mergedMap.set(result.chunkId, {
          ...result,
          score: result.score * 0.7,
        });
      }

      // 关键词检索结果权重 0.3
      for (const result of keywordResults) {
        if (mergedMap.has(result.chunkId)) {
          // 如果已存在，累加分数
          const existing = mergedMap.get(result.chunkId)!;
          existing.score += result.score * 0.3;
        } else {
          mergedMap.set(result.chunkId, {
            ...result,
            score: result.score * 0.3,
          });
        }
      }

      // 3. 按分数排序并返回 topK
      const results = Array.from(mergedMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      this.logger.log(`Hybrid search returned ${results.length} chunks`);
      return results;
    } catch (error) {
      this.logger.error('Hybrid search failed', error);
      // 降级到仅使用向量检索
      this.logger.warn('Falling back to vector search only');
      return this.vectorSearch(kbId, query, topK);
    }
  }

  /**
   * 重排序（可选：使用更复杂的算法）
   */
  async rerank(results: RetrievalResult[], query: string): Promise<RetrievalResult[]> {
    // 简单实现：按分数排序
    // 未来可以集成专门的 reranker 模型
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 检查知识库权限
   */
  async checkKbAccess(kbId: string, userId: string): Promise<boolean> {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: kbId,
        deletedAt: null,
      },
    });

    if (!kb) {
      return false;
    }

    // 检查 ACL 权限
    if (kb.aclScope === 'public') {
      return true;
    }

    if (kb.userId === userId) {
      return true;
    }

    if (kb.aclScope === 'private') {
      return false;
    }

    // 检查 aclUsers
    const aclUsers = kb.aclUsers as string[] || [];
    return aclUsers.includes(userId);
  }
}
