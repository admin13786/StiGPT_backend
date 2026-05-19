import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentProcessorService } from './document-processor.service';
import * as crypto from 'crypto';
import * as fs from 'fs';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private prisma: PrismaService,
    private processor: DocumentProcessorService,
  ) {}

  async upload(kbId: string, file: Express.Multer.File, userId: string) {
    try {
      // 检查知识库权限
      const kb = await this.prisma.knowledgeBase.findFirst({
        where: { id: kbId, deletedAt: null },
      });

      if (!kb) {
        // 删除上传的文件
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        throw new NotFoundException('知识库不存在');
      }

      if (kb.userId !== userId) {
        // 删除上传的文件
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        throw new ForbiddenException('无权限上传文档到此知识库');
      }

      // 计算文件哈希
      const fileBuffer = fs.readFileSync(file.path);
      const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

      // 检查是否已存在
      const existing = await this.prisma.document.findFirst({
        where: { kbId, fileHash, deletedAt: null },
      });

      if (existing) {
        // 删除上传的文件
        fs.unlinkSync(file.path);
        return {
          success: false,
          message: '文档已存在',
          data: existing,
        };
      }

      // 创建文档记录
      const document = await this.prisma.document.create({
        data: {
          kbId,
          title: file.originalname,
          filePath: file.path,
          fileType: file.originalname.split('.').pop()?.toLowerCase() || 'unknown',
          fileSize: file.size,
          fileHash,
          status: 'pending',
        },
      });

      this.logger.log(`Document ${document.id} uploaded to kb ${kbId}`);

      // 异步处理文档
      this.processor.processDocument(document.id).catch((error) => {
        this.logger.error(`Failed to process document ${document.id}`, error);
      });

      return {
        success: true,
        data: document,
        message: '文档上传成功，正在处理中',
      };
    } catch (error) {
      this.logger.error('Failed to upload document', error);
      throw error;
    }
  }

  async findAll(kbId: string, params: any, userId: string) {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    // 检查权限
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, deletedAt: null },
    });

    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }

    const where: any = {
      kbId,
      deletedAt: null,
    };

    if (status) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { uploadTime: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        knowledgeBase: true,
        chunks: {
          take: 5,
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });

    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    return {
      success: true,
      data: doc,
    };
  }

  async getStatus(id: string, userId: string) {
    const doc = await this.findOne(id, userId);

    return {
      success: true,
      data: {
        status: doc.data.status,
        chunkCount: doc.data.chunkCount,
        tokenCount: doc.data.tokenCount,
        errorMessage: doc.data.errorMessage,
        processedAt: doc.data.processedAt,
      },
    };
  }

  async remove(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: { knowledgeBase: true },
    });

    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    if (doc.knowledgeBase.userId !== userId) {
      throw new ForbiddenException('无权限删除此文档');
    }

    // 软删除
    await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // 删除文件
    if (fs.existsSync(doc.filePath)) {
      fs.unlinkSync(doc.filePath);
    }

    // 更新知识库统计
    await this.prisma.knowledgeBase.update({
      where: { id: doc.kbId },
      data: {
        documentCount: { decrement: 1 },
        chunkCount: { decrement: doc.chunkCount },
      },
    });

    this.logger.log(`Document ${id} deleted`);

    return {
      success: true,
      message: '文档已删除',
    };
  }

  async reprocess(id: string, userId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: { knowledgeBase: true },
    });

    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    if (doc.knowledgeBase.userId !== userId) {
      throw new ForbiddenException('无权限重新处理此文档');
    }

    // 重置状态
    await this.prisma.document.update({
      where: { id },
      data: {
        status: 'pending',
        errorMessage: null,
        processedAt: null,
        chunkCount: 0,
        tokenCount: 0,
      },
    });

    // 删除旧的 chunks
    await this.prisma.documentChunk.deleteMany({
      where: { documentId: id },
    });

    this.logger.log(`Document ${id} queued for reprocessing`);

    // 异步处理
    this.processor.processDocument(id).catch((error) => {
      this.logger.error(`Failed to reprocess document ${id}`, error);
    });

    return {
      success: true,
      message: '已加入处理队列',
    };
  }
}
