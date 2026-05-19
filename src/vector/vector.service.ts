import { Injectable, Logger } from '@nestjs/common';
import { MilvusService } from './milvus.service';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class VectorService {
  private readonly logger = new Logger(VectorService.name);

  constructor(
    private milvus: MilvusService,
    private embedding: EmbeddingService,
  ) {}

  async createCollection(kbId: string) {
    return this.milvus.createCollection(kbId);
  }

  async insertVectors(kbId: string, chunks: any[]): Promise<string[]> {
    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    
    try {
      // 确保集合存在
      await this.milvus.createCollection(kbId);

      // 准备数据
      const data = chunks.map(chunk => ({
        vector: chunk.vector,
        chunk_id: chunk.chunkId || chunk.id || '',
        document_id: chunk.documentId,
        content: chunk.content.substring(0, 65535), // 限制长度
      }));

      // 批量插入
      const batchSize = 100;
      const allIds: string[] = [];

      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const ids = await this.milvus.insert(collectionName, batch);
        allIds.push(...ids.map(id => id.toString()));
      }

      this.logger.log(`Inserted ${allIds.length} vectors for kb ${kbId}`);
      return allIds;
    } catch (error) {
      this.logger.error(`Failed to insert vectors for kb ${kbId}`, error);
      throw error;
    }
  }

  async search(
    kbId: string,
    queryVector: number[],
    topK: number = 5,
    filter?: string,
  ) {
    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    
    try {
      const results = await this.milvus.search(
        collectionName,
        [queryVector],
        topK,
        filter,
      );

      // results 是二维数组，取第一个查询的结果
      const searchResults = results[0] || [];
      
      // 格式化结果
      return searchResults.map((result: any) => ({
        id: result.id,
        score: result.score,
        chunkId: result.chunk_id,
        documentId: result.document_id,
        content: result.content,
      }));
    } catch (error) {
      this.logger.error(`Failed to search in kb ${kbId}`, error);
      throw error;
    }
  }

  async deleteByDocumentId(kbId: string, documentId: string) {
    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    await this.milvus.deleteByDocumentId(collectionName, documentId);
  }

  async deleteCollection(kbId: string) {
    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    await this.milvus.deleteCollection(collectionName);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedding.embed(text);
  }

  // 别名方法，与 retrieval.service.ts 兼容
  async embedText(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedding.embedBatch(texts);
  }

  // 别名方法，与 document-processor.service.ts 兼容
  async embedTexts(texts: string[]): Promise<number[][]> {
    return this.embedBatch(texts);
  }

  // 别名方法，与 retrieval.service.ts 兼容
  async searchVectors(
    kbId: string,
    queryVectors: number[][],
    topK: number = 5,
    filter?: string,
  ) {
    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    
    try {
      const results = await this.milvus.search(
        collectionName,
        queryVectors,
        topK,
        filter,
      );

      // results 已经是二维数组，每个查询向量对应一个结果数组
      return results.map((queryResults: any[]) => 
        queryResults.map((result: any) => ({
          id: result.id,
          score: result.score,
          chunkId: result.chunk_id,
          documentId: result.document_id,
          content: result.content,
        }))
      );
    } catch (error) {
      this.logger.error(`Failed to search vectors in kb ${kbId}`, error);
      throw error;
    }
  }

  estimateTokens(text: string): number {
    return this.embedding.estimateTokens(text);
  }
}
