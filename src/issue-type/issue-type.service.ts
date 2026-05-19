import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes } from '../common/exceptions';
import { CreateIssueTypeDto } from './dto/create-issue-type.dto';
import { UpdateIssueTypeDto } from './dto/update-issue-type.dto';
import { CacheService } from '../common/cache/cache.service';

@Injectable()
export class IssueTypeService {
  private readonly cachePrefix = 'cache:issue-type:';
  private readonly cacheTtlSeconds: number;

  constructor(
    private prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    const ttl = Number(
      this.configService.get<number>('CACHE_CONFIG_TTL_SECONDS') ?? 900,
    );
    this.cacheTtlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 900;
  }

  private async clearCache() {
    await this.cacheService.delByPrefix(this.cachePrefix);
  }

  // 获取启用的问题类型（玩家端）
  async findEnabled() {
    const cacheKey = `${this.cachePrefix}enabled`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.issueType.findMany({
        where: {
          enabled: true,
          deletedAt: null,
        },
        orderBy: {
          sortOrder: 'asc',
        },
        select: {
          id: true,
          name: true,
          description: true,
          priorityWeight: true,
          icon: true,
          sortOrder: true,
          requireDirectTransfer: true,
        },
      }),
    );
  }

  // 获取所有问题类型（管理端）
  async findAll() {
    const cacheKey = `${this.cachePrefix}all`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.issueType.findMany({
        where: {
          deletedAt: null,
        },
        orderBy: {
          sortOrder: 'asc',
        },
      }),
    );
  }

  // 根据 ID 获取问题类型
  async findOne(id: string) {
    const issueType = await this.prisma.issueType.findUnique({
      where: { id },
    });
    if (!issueType || issueType.deletedAt) {
      throw new BusinessException(ErrorCodes.ISSUE_TYPE_NOT_FOUND);
    }
    return issueType;
  }

  // 创建问题类型
  async create(createDto: CreateIssueTypeDto) {
    const created = await this.prisma.issueType.create({
      data: createDto,
    });
    await this.clearCache();
    return created;
  }

  // 更新问题类型
  async update(id: string, updateDto: UpdateIssueTypeDto) {
    await this.findOne(id); // 验证存在
    const updated = await this.prisma.issueType.update({
      where: { id },
      data: updateDto,
    });
    await this.clearCache();
    return updated;
  }

  // 切换启用状态
  async toggle(id: string) {
    const issueType = await this.findOne(id);
    const updated = await this.prisma.issueType.update({
      where: { id },
      data: { enabled: !issueType.enabled },
    });
    await this.clearCache();
    return updated;
  }

  // 软删除
  async remove(id: string) {
    await this.findOne(id);
    const removed = await this.prisma.issueType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.clearCache();
    return removed;
  }

  // 批量获取问题类型（用于优先级计算）
  async findByIds(ids: string[]) {
    if (!ids || ids.length === 0) {
      return [];
    }
    const sortedIds = Array.from(new Set(ids)).sort();
    const cacheKey = `${this.cachePrefix}by-ids:${sortedIds.join(',')}`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.issueType.findMany({
        where: {
          id: { in: sortedIds },
          enabled: true,
          deletedAt: null,
        },
      }),
    );
  }
}
