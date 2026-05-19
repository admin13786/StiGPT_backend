import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

@Injectable()
export class KnowledgeService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateKnowledgeBaseDto, userId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.create({
      data: {
        name: dto.name,
        description: dto.description,
        userId,
        aclScope: dto.aclScope || 'internal',
        aclUsers: dto.aclUsers,
        embeddingModel: dto.embeddingModel || 'text-embedding-v2',
        chunkSize: dto.chunkSize || 500,
        chunkOverlap: dto.chunkOverlap || 50,
      },
    });

    return {
      success: true,
      data: knowledgeBase,
    };
  }

  async findAll(
    params: { page: number; limit: number; search?: string },
    userId: string,
  ) {
    const { page, limit, search } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      OR: [
        { userId },
        { aclScope: 'public' },
        { aclScope: 'internal' },
      ],
    };

    if (search) {
      where.name = {
        contains: search,
        mode: 'insensitive',
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              realName: true,
            },
          },
        },
      }),
      this.prisma.knowledgeBase.count({ where }),
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
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            realName: true,
          },
        },
      },
    });

    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }

    // 检查权限
    if (!this.checkPermission(kb, userId)) {
      throw new ForbiddenException('无权限访问此知识库');
    }

    return {
      success: true,
      data: kb,
    };
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto, userId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id, deletedAt: null },
    });

    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }

    if (kb.userId !== userId) {
      throw new ForbiddenException('只有创建者可以修改知识库');
    }

    const updated = await this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        ...dto,
        updatedAt: new Date(),
      },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async remove(id: string, userId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id, deletedAt: null },
    });

    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }

    if (kb.userId !== userId) {
      throw new ForbiddenException('只有创建者可以删除知识库');
    }

    // 软删除
    await this.prisma.knowledgeBase.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: '知识库已删除',
    };
  }

  async getStats(id: string, userId: string) {
    const kb = await this.findOne(id, userId);

    const stats = {
      documentCount: kb.data.documentCount,
      chunkCount: kb.data.chunkCount,
      totalSize: 0,
      processingCount: 0,
      readyCount: 0,
      failedCount: 0,
    };

    const documents = await this.prisma.document.findMany({
      where: {
        kbId: id,
        deletedAt: null,
      },
      select: {
        fileSize: true,
        status: true,
      },
    });

    documents.forEach((doc) => {
      stats.totalSize += doc.fileSize;
      if (doc.status === 'processing') stats.processingCount++;
      if (doc.status === 'ready') stats.readyCount++;
      if (doc.status === 'failed') stats.failedCount++;
    });

    return {
      success: true,
      data: stats,
    };
  }

  private checkPermission(kb: any, userId: string): boolean {
    // 创建者有权限
    if (kb.userId === userId) return true;

    // 公开知识库
    if (kb.aclScope === 'public') return true;

    // 内部知识库（所有登录用户）
    if (kb.aclScope === 'internal') return true;

    // 私有知识库，检查 aclUsers
    if (kb.aclScope === 'private' && kb.aclUsers) {
      const allowedUsers = kb.aclUsers as string[];
      return allowedUsers.includes(userId);
    }

    return false;
  }
}
