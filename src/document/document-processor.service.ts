import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VectorService } from '../vector/vector.service';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';

// 使用 require 导入 pdf-parse
const pdfParse = require('pdf-parse');

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);
  private readonly md = new MarkdownIt();

  constructor(
    private prisma: PrismaService,
    private vectorService: VectorService,
  ) {}

  /**
   * 处理文档：解析、分块、向量化、存储
   */
  async processDocument(documentId: string): Promise<void> {
    this.logger.log(`Starting to process document ${documentId}`);

    try {
      // 更新状态为处理中
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' },
      });

      // 获取文档信息
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: { knowledgeBase: true },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // 1. 解析文档
      this.logger.log(`Parsing document ${documentId}`);
      const content = await this.parseDocument(document.filePath, document.fileType);

      // 2. 分块
      this.logger.log(`Chunking document ${documentId}`);
      const chunks = await this.chunkText(content, {
        chunkSize: parseInt(process.env.CHUNK_SIZE || '500'),
        chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '50'),
      });

      this.logger.log(`Created ${chunks.length} chunks for document ${documentId}`);

      // 3. 批量向量化并存储
      const batchSize = 10;
      let totalTokens = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        
        // 向量化
        const texts = batch.map(c => c.text);
        const embeddings = await this.vectorService.embedTexts(texts);

        // 准备向量数据
        const vectorData = batch.map((chunk, idx) => ({
          vector: embeddings[idx],
          chunkId: `${document.id}_${chunk.index}`,
          documentId: document.id,
          content: chunk.text,
        }));

        // 存储到向量数据库
        const vectorIds = await this.vectorService.insertVectors(
          document.kbId,
          vectorData,
        );

        // 存储到数据库
        const chunkRecords = batch.map((chunk, idx) => ({
          documentId: document.id,
          chunkIndex: chunk.index,
          content: chunk.text,
          vectorId: vectorIds[idx],
          tokenCount: this.estimateTokens(chunk.text),
          metadata: chunk.metadata,
        }));

        await this.prisma.documentChunk.createMany({
          data: chunkRecords,
        });

        totalTokens += chunkRecords.reduce((sum, c) => sum + c.tokenCount, 0);

        this.logger.log(
          `Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)} for document ${documentId}`,
        );
      }

      // 4. 更新文档状态
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'completed',
          chunkCount: chunks.length,
          tokenCount: totalTokens,
          processedAt: new Date(),
        },
      });

      // 5. 更新知识库统计
      await this.prisma.knowledgeBase.update({
        where: { id: document.kbId },
        data: {
          documentCount: { increment: 1 },
          chunkCount: { increment: chunks.length },
        },
      });

      this.logger.log(`Successfully processed document ${documentId}`);
    } catch (error) {
      this.logger.error(`Failed to process document ${documentId}`, error);

      // 更新为失败状态
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'failed',
          errorMessage: error.message || 'Unknown error',
        },
      });

      throw error;
    }
  }

  /**
   * 解析文档内容
   */
  private async parseDocument(filePath: string, fileType: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);

    switch (fileType.toLowerCase()) {
      case 'pdf':
        return this.parsePDF(buffer);
      case 'md':
      case 'markdown':
        return this.parseMarkdown(buffer);
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  /**
   * 解析 PDF 文件
   */
  private async parsePDF(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      this.logger.error('Failed to parse PDF', error);
      throw new Error('PDF parsing failed');
    }
  }

  /**
   * 解析 Markdown 文件
   */
  private parseMarkdown(buffer: Buffer): string {
    try {
      const text = buffer.toString('utf-8');
      // 将 Markdown 转换为纯文本（移除格式标记）
      const html = this.md.render(text);
      // 简单的 HTML 标签移除
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (error) {
      this.logger.error('Failed to parse Markdown', error);
      throw new Error('Markdown parsing failed');
    }
  }

  /**
   * 文本分块
   */
  private async chunkText(
    text: string,
    options: { chunkSize: number; chunkOverlap: number },
  ): Promise<Array<{ index: number; text: string; metadata: any }>> {
    const { chunkSize, chunkOverlap } = options;
    const chunks: Array<{ index: number; text: string; metadata: any }> = [];

    // 按段落分割
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    let currentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      // 如果当前段落本身就超过 chunkSize，需要进一步分割
      if (paragraphTokens > chunkSize) {
        // 保存当前 chunk
        if (currentChunk.trim().length > 0) {
          chunks.push({
            index: chunkIndex++,
            text: currentChunk.trim(),
            metadata: { tokenCount: this.estimateTokens(currentChunk) },
          });
          currentChunk = '';
        }

        // 按句子分割长段落
        const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
        let sentenceChunk = '';

        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokens(sentence);

          if (this.estimateTokens(sentenceChunk + sentence) <= chunkSize) {
            sentenceChunk += sentence;
          } else {
            if (sentenceChunk.trim().length > 0) {
              chunks.push({
                index: chunkIndex++,
                text: sentenceChunk.trim(),
                metadata: { tokenCount: this.estimateTokens(sentenceChunk) },
              });
            }
            sentenceChunk = sentence;
          }
        }

        if (sentenceChunk.trim().length > 0) {
          chunks.push({
            index: chunkIndex++,
            text: sentenceChunk.trim(),
            metadata: { tokenCount: this.estimateTokens(sentenceChunk) },
          });
        }
      } else {
        // 检查添加这个段落是否会超过 chunkSize
        const potentialChunk = currentChunk + '\n\n' + paragraph;
        const potentialTokens = this.estimateTokens(potentialChunk);

        if (potentialTokens <= chunkSize) {
          currentChunk = potentialChunk;
        } else {
          // 保存当前 chunk
          if (currentChunk.trim().length > 0) {
            chunks.push({
              index: chunkIndex++,
              text: currentChunk.trim(),
              metadata: { tokenCount: this.estimateTokens(currentChunk) },
            });
          }

          // 开始新的 chunk，包含 overlap
          if (chunkOverlap > 0 && currentChunk.length > 0) {
            const overlapText = currentChunk.slice(-chunkOverlap);
            currentChunk = overlapText + '\n\n' + paragraph;
          } else {
            currentChunk = paragraph;
          }
        }
      }
    }

    // 保存最后一个 chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk.trim(),
        metadata: { tokenCount: this.estimateTokens(currentChunk) },
      });
    }

    return chunks;
  }

  /**
   * 估算 token 数量（简单实现：中文按字符，英文按单词）
   */
  private estimateTokens(text: string): number {
    // 中文字符
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    // 英文单词
    const englishWords = text.match(/[a-zA-Z]+/g) || [];
    // 数字和符号
    const others = text.match(/[0-9]+/g) || [];

    return chineseChars.length + englishWords.length + Math.floor(others.length / 2);
  }
}
