import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes } from '../common/exceptions';
import { AppLogger } from '../common/logger/app-logger.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { UpdateReplyDto } from './dto/update-reply.dto';
import { QueryReplyDto, SortByEnum } from './dto/query-reply.dto';
import { CacheService } from '../common/cache/cache.service';

@Injectable()
export class QuickReplyService {
  private readonly cachePrefix = 'cache:quick-reply:';
  private readonly cacheTtlSeconds: number;

  constructor(
    private prisma: PrismaService,
    private readonly logger: AppLogger,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    const ttl = Number(
      this.configService.get<number>('CACHE_QUICK_REPLY_TTL_SECONDS') ?? 60,
    );
    this.cacheTtlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 60;
    this.logger.setContext(QuickReplyService.name);
  }

  private buildQueryKey(query: QueryReplyDto): string {
    const entries = Object.entries(query).filter(
      ([, value]) => value !== undefined,
    );
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');
  }

  private async clearUserCache(userId: string) {
    const prefix = `${this.cachePrefix}${userId}:`;
    await this.cacheService.delByPrefix(prefix);
  }

  // ========== 分类管理 ==========

  /**
   * 获取分类列表 - 只返回当前用户自己创建的分类
   */
  async getCategories(userId: string, isAdmin: boolean) {
    const cacheKey = `${this.cachePrefix}${userId}:categories`;
    const cached = await this.cacheService.getJson<any[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    try {
      const where: any = {
        isActive: true,
        deletedAt: null,
        creatorId: userId, // ✅ 只查询当前用户创建的分类
      };
      // 取消管理员特殊权限，管理员也只能看到自己创建的分类

      const categories = await this.prisma.quickReplyCategory.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
      });

      // 如果分类为空，直接返回空数组
      if (categories.length === 0) {
        const result: any[] = [];
        await this.cacheService.setJson(
          cacheKey,
          result,
          this.cacheTtlSeconds,
        );
        return result;
      }

      // 批量查询所有分类的回复数量（只统计当前用户的回复）
      const categoryIds = categories.map((cat) => cat.id);
      const replyCounts = await this.prisma.quickReply.groupBy({
        by: ['categoryId'],
        where: {
          categoryId: { in: categoryIds },
          creatorId: userId, // ✅ 只统计当前用户的回复
          isActive: true,
          deletedAt: null,
        },
        _count: {
          id: true,
        },
      });

      // 创建回复数量的映射
      const countMap = new Map(
        replyCounts.map((item) => [item.categoryId, item._count.id]),
      );

      // 为每个分类添加回复数量
      const result = categories.map((category) => ({
        ...category,
        _count: {
          replies: countMap.get(category.id) || 0,
        },
      }));
      await this.cacheService.setJson(
        cacheKey,
        result,
        this.cacheTtlSeconds,
      );
      return result;
    } catch (error) {
      this.logger.error(
        '获取分类列表失败',
        error instanceof Error ? error.stack : undefined,
        { userId },
      );
      throw error;
    }
  }

  /**
   * 创建分类 - 所有分类都是个人私有的
   */
  async createCategory(
    userId: string,
    isAdmin: boolean,
    createCategoryDto: CreateCategoryDto,
  ) {
    // ✅ 所有分类都是个人私有的，取消全局分类
    const created = await this.prisma.quickReplyCategory.create({
      data: {
        ...createCategoryDto,
        creatorId: userId, // 始终设置为当前用户
        isGlobal: false, // 强制设置为false
      },
    });
    await this.clearUserCache(userId);
    return created;
    await this.clearUserCache(userId);
    return created;
  }

  /**
   * 更新分类 - 只能更新自己创建的分类
   */
  async updateCategory(
    categoryId: string,
    userId: string,
    isAdmin: boolean,
    updateCategoryDto: UpdateCategoryDto,
  ) {
    const category = await this.prisma.quickReplyCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    // ✅ 只能更新自己创建的分类
    if (category.creatorId !== userId) {
      throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能更新自己创建的分类');
    }

    // ✅ 取消全局标记，强制设置为false
    const updateData: any = {
      ...updateCategoryDto,
      isGlobal: false, // 强制设置为false
    };
    const updated = await this.prisma.quickReplyCategory.update({
      where: { id: categoryId },
      data: updateData,
    });
    await this.clearUserCache(userId);
    return updated;
  }

  /**
   * 删除分类 - 只能删除自己创建的分类
   */
  async deleteCategory(categoryId: string, userId: string, isAdmin: boolean) {
    const category = await this.prisma.quickReplyCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    // ✅ 只能删除自己创建的分类
    if (category.creatorId !== userId) {
      throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能删除自己创建的分类');
    }

    const removed = await this.prisma.quickReplyCategory.update({
      where: { id: categoryId },
      data: { deletedAt: new Date() },
    });
    await this.clearUserCache(userId);
    return removed;
  }

  // ========== 快捷回复管理 ==========

  /**
   * 获取快捷回复列表
   */
  async getReplies(userId: string, isAdmin: boolean, query: QueryReplyDto) {
    try {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const skip = (page - 1) * pageSize;
      const cacheKey = `${this.cachePrefix}${userId}:replies:${this.buildQueryKey(
        {
          ...query,
          page,
          pageSize,
        },
      )}`;
      const cached = await this.cacheService.getJson<any>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // 构建 WHERE 条件
      const where: any = {
        deletedAt: null,
      };

      // 启用状态筛选：
      // - 如果明确指定了 isActive (true/false)，使用指定值
      // - 如果 isActive 为 null，查询所有状态的回复（全部）
      // - 如果 isActive 为 undefined，默认只查询启用的回复（保持向后兼容，用于其他地方的调用）
      if (query.isActive === null) {
        // 用户选择"全部"，不添加 isActive 条件，查询所有状态的回复
        // 不设置 where.isActive，查询所有
      } else if (query.isActive !== undefined) {
        // 明确指定了 true 或 false
        where.isActive = query.isActive;
      } else {
        // undefined 表示默认行为（保持向后兼容），只查询启用的
        where.isActive = true;
      }

      if (query.categoryId) {
        // ✅ 确保分类也是当前用户创建的
        const category = await this.prisma.quickReplyCategory.findUnique({
          where: { id: query.categoryId },
        });
        if (!category || category.creatorId !== userId) {
          throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '无权访问此分类');
        }
        where.categoryId = query.categoryId;
      }

      // ✅ 修改：只查询当前用户创建的回复
      where.creatorId = userId;

      // 只看收藏的回复
      if (query.onlyFavorites) {
        const favoriteIds = await this.prisma.quickReplyFavorite
          .findMany({
            where: { userId },
            select: { replyId: true },
          })
          .then((fav) => fav.map((f) => f.replyId));

        if (favoriteIds.length === 0) {
          // 如果没有收藏，直接返回空结果
          const result = {
            data: [],
            pagination: {
              total: 0,
              page,
              pageSize,
              totalPages: 0,
            },
          };
          await this.cacheService.setJson(
            cacheKey,
            result,
            this.cacheTtlSeconds,
          );
          return result;
        }

        where.id = { in: favoriteIds };
      }

      // 只看最近使用的回复
      if (query.onlyRecent) {
        where.lastUsedAt = { not: null };
      }

      // 构建排序条件
      let orderBy = this.buildOrderBy(query.sortBy);

      // 查询数据和总数
      let data, total, favoriteIdsSet;
      try {
        [data, total, favoriteIdsSet] = await Promise.all([
          this.prisma.quickReply.findMany({
            where,
            orderBy,
            skip,
            take: pageSize,
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  isGlobal: true,
                  isActive: true,
                  sortOrder: true,
                },
              },
            },
          }),
          this.prisma.quickReply.count({ where }),
          // 获取当前用户收藏的所有回复 ID
          this.prisma.quickReplyFavorite
            .findMany({
              where: { userId },
              select: { replyId: true },
            })
            .then((favs) => new Set(favs.map((f) => f.replyId))),
        ]);
      } catch (dbError: any) {
        this.logger.error(
          '数据库查询错误',
          dbError instanceof Error ? dbError.stack : undefined,
          {
            errorType: dbError.constructor?.name,
            errorCode: dbError.code,
            errorMessage: dbError.message,
            userId,
            categoryId: query.categoryId,
          },
        );

        // 如果是排序问题，尝试使用默认排序
        if (
          dbError.code === 'P2009' ||
          dbError.message?.includes('orderBy') ||
          dbError.message?.includes('sort')
        ) {
          this.logger.warn('检测到排序错误，尝试使用默认排序...');
          orderBy = { createdAt: 'desc' };
          [data, total, favoriteIdsSet] = await Promise.all([
            this.prisma.quickReply.findMany({
              where,
              orderBy,
              skip,
              take: pageSize,
              include: {
                category: {
                  select: {
                    id: true,
                    name: true,
                    isGlobal: true,
                    isActive: true,
                    sortOrder: true,
                  },
                },
              },
            }),
            this.prisma.quickReply.count({ where }),
            this.prisma.quickReplyFavorite
              .findMany({
                where: { userId },
                select: { replyId: true },
              })
              .then((favs) => new Set(favs.map((f) => f.replyId))),
          ]);
        } else {
          throw dbError;
        }
      }

      // 如果按 lastUsedAt 排序，对结果进行二次排序（将 null 值排在最后）
      let sortedData = data;
      if (
        query.sortBy === 'lastUsedAt' ||
        query.sortBy === SortByEnum.LAST_USED_AT
      ) {
        sortedData = [...data].sort((a, b) => {
          // 如果两个都是 null，按 createdAt 排序
          if (!a.lastUsedAt && !b.lastUsedAt) {
            return (
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
          }
          // 如果 a 是 null，排在后面
          if (!a.lastUsedAt) return 1;
          // 如果 b 是 null，排在后面
          if (!b.lastUsedAt) return -1;
          // 两个都不是 null，按 lastUsedAt 排序
          return (
            new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
          );
        });
      }

      // 后端去重：根据 id 和内容双重去重，确保不会返回重复数据
      const uniqueRepliesById = new Map();
      sortedData.forEach((reply) => {
        if (!uniqueRepliesById.has(reply.id)) {
          uniqueRepliesById.set(reply.id, reply);
        }
      });
      let deduplicatedData = Array.from(uniqueRepliesById.values());

      // 根据内容去重（防止数据库中有相同内容但不同 id 的重复数据）
      const uniqueRepliesByContent = new Map();
      deduplicatedData.forEach((reply) => {
        const contentKey = (reply.content || '').trim();
        if (!uniqueRepliesByContent.has(contentKey)) {
          uniqueRepliesByContent.set(contentKey, reply);
        } else {
          // 保留使用次数更高的，如果使用次数相同，保留 id 更小的（更早创建的）
          const existing = uniqueRepliesByContent.get(contentKey);
          if (reply.usageCount > existing.usageCount) {
            uniqueRepliesByContent.set(contentKey, reply);
          } else if (
            reply.usageCount === existing.usageCount &&
            reply.id < existing.id
          ) {
            uniqueRepliesByContent.set(contentKey, reply);
          }
        }
      });
      deduplicatedData = Array.from(uniqueRepliesByContent.values());

      // ✅ 返回数据（不需要个人偏好，因为所有回复都是个人的）
      const result = {
        data: deduplicatedData.map((reply) => ({
          ...reply,
          isFavorited: favoriteIdsSet.has(reply.id),
          hasPersonalPreference: false, // 所有回复都是个人的，不需要个人偏好
        })),
        pagination: {
          total: deduplicatedData.length, // 使用去重后的数量
          page,
          pageSize,
          totalPages: Math.ceil(deduplicatedData.length / pageSize),
        },
      };
    } catch (error: any) {
      this.logger.error(
        '获取快捷回复列表失败',
        error instanceof Error ? error.stack : undefined,
        {
          errorMessage: error.message,
          errorName: error.name,
          userId,
          categoryId: query.categoryId,
          page: query.page,
          pageSize: query.pageSize,
        },
      );
      throw error;
    }
  }

  /**
   * 创建快捷回复 - 所有回复都是个人私有的
   */
  async createReply(
    userId: string,
    isAdmin: boolean,
    createReplyDto: CreateReplyDto,
  ) {
    // 验证分类存在且是当前用户创建的
    const category = await this.prisma.quickReplyCategory.findUniqueOrThrow({
      where: { id: createReplyDto.categoryId },
    });

    // ✅ 只能在自己的分类中创建回复
    if (category.creatorId !== userId) {
      throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能在自己的分类中创建回复');
    }

    // ✅ 所有回复都是个人私有的
    const created = await this.prisma.quickReply.create({
      data: {
        ...createReplyDto,
        creatorId: userId, // 始终设置为当前用户
        isGlobal: false, // 强制设置为false
      },
      include: { category: true },
    });
  }

  /**
   * 更新快捷回复 - 只能更新自己创建的回复
   */
  async updateReply(
    replyId: string,
    userId: string,
    isAdmin: boolean,
    updateReplyDto: UpdateReplyDto,
  ) {
    try {
      const reply = await this.prisma.quickReply.findUniqueOrThrow({
        where: { id: replyId },
      });

      // ✅ 只能更新自己创建的回复（处理 creatorId 为 null 的情况）
      if (!reply.creatorId || reply.creatorId !== userId) {
        throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能更新自己创建的快捷回复');
      }

      // ✅ 如果更新了分类，确保新分类也是当前用户创建的
      if (
        updateReplyDto.categoryId &&
        updateReplyDto.categoryId !== reply.categoryId
      ) {
        try {
          const newCategory =
            await this.prisma.quickReplyCategory.findUniqueOrThrow({
              where: { id: updateReplyDto.categoryId },
            });
          if (!newCategory.creatorId || newCategory.creatorId !== userId) {
            throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能移动到自己的分类');
          }
        } catch (error: any) {
          if (error.code === 'P2025') {
            throw new BusinessException(ErrorCodes.SYSTEM_VALIDATION_ERROR, '分类不存在');
          }
          throw error;
        }
      }

      // ✅ 构建更新数据，只包含实际要更新的字段（过滤掉 undefined）
      const updateData: any = {
        isGlobal: false, // 强制设置为false
      };

      // 只添加有值的字段
      if (updateReplyDto.content !== undefined) {
        updateData.content = updateReplyDto.content;
      }
      if (updateReplyDto.categoryId !== undefined) {
        updateData.categoryId = updateReplyDto.categoryId;
      }
      if (updateReplyDto.isActive !== undefined) {
        updateData.isActive = updateReplyDto.isActive;
      }
      if (updateReplyDto.sortOrder !== undefined) {
        updateData.sortOrder = updateReplyDto.sortOrder;
      }

      // 确保至少有一个字段要更新（除了 isGlobal）
      const fieldsToUpdate = Object.keys(updateData).filter(
        (key) => key !== 'isGlobal',
      );
      if (fieldsToUpdate.length === 0) {
        // 如果没有要更新的字段，直接返回当前记录
        const currentReply = await this.prisma.quickReply.findUnique({
          where: { id: replyId },
          include: { category: true },
        });
        if (!currentReply) {
          throw new BusinessException(ErrorCodes.SYSTEM_VALIDATION_ERROR, '快捷回复不存在');
        }
        return currentReply;
      }

      const updated = await this.prisma.quickReply.update({
        where: { id: replyId },
        data: updateData,
        include: { category: true },
      });
      await this.clearUserCache(userId);
      return updated;
    } catch (error: any) {
      // 处理 Prisma 的 NotFoundError (P2025)
      if (error.code === 'P2025') {
        throw new BusinessException(ErrorCodes.SYSTEM_VALIDATION_ERROR, '快捷回复不存在');
      }
      // 重新抛出其他错误
      throw error;
    }
  }

  /**
   * 删除快捷回复 - 只能删除自己创建的回复
   */
  async deleteReply(replyId: string, userId: string, isAdmin: boolean) {
    const reply = await this.prisma.quickReply.findUniqueOrThrow({
      where: { id: replyId },
    });

    // ✅ 只能删除自己创建的回复
    if (reply.creatorId !== userId) {
      throw new BusinessException(ErrorCodes.AUTH_PERMISSION_DENIED, '只能删除自己创建的快捷回复');
    }

    const removed = await this.prisma.quickReply.update({
      where: { id: replyId },
      data: { deletedAt: new Date() },
    });
    await this.clearUserCache(userId);
    return removed;
  }

  // ========== 收藏管理 ==========

  /**
   * 切换收藏状态
   */
  async toggleFavorite(replyId: string, userId: string): Promise<void> {
    // ⭐ 验证回复存在
    await this.prisma.quickReply.findUniqueOrThrow({
      where: { id: replyId },
    });

    // ⭐ 使用事务保证原子性
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.quickReplyFavorite.findUnique({
        where: {
          userId_replyId: { userId, replyId },
        },
      });

      if (existing) {
        // 取消收藏
        await tx.quickReplyFavorite.delete({
          where: { id: existing.id },
        });
        await tx.quickReply.update({
          where: { id: replyId },
          data: { favoriteCount: { decrement: 1 } },
        });
      } else {
        // 添加收藏
        await tx.quickReplyFavorite.create({
          data: { userId, replyId },
        });
        await tx.quickReply.update({
          where: { id: replyId },
          data: { favoriteCount: { increment: 1 } },
        });
      }
    });
    await this.clearUserCache(userId);
  }

  /**
   * 获取用户收藏列表
   */
  async getUserFavorites(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ) {
    const cacheKey = `${this.cachePrefix}${userId}:favorites:${page}:${pageSize}`;
    const cached = await this.cacheService.getJson<any>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.quickReplyFavorite.findMany({
        where: {
          userId,
          reply: {
            isActive: true, // 只返回启用的回复
            deletedAt: null,
          },
        },
        include: {
          reply: {
            include: { category: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.quickReplyFavorite.count({
        where: {
          userId,
          reply: {
            isActive: true, // 只统计启用的回复
            deletedAt: null,
          },
        },
      }),
    ]);

    const result = {
      data: data.map((fav) => ({
        ...fav.reply,
        isFavorited: true, // 收藏列表中的都是已收藏的
      })),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // ========== 使用统计 ==========

  /**
   * 增加使用次数
   */
  async incrementUsage(replyId: string): Promise<void> {
    const updated = await this.prisma.quickReply.update({
      where: { id: replyId },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
      select: {
        creatorId: true,
      },
    });
    if (updated?.creatorId) {
      await this.clearUserCache(updated.creatorId);
    }
  }

  // ========== 辅助方法 ==========

  /**
   * 构建排序条件
   */
  private buildOrderBy(sortBy?: SortByEnum | string): any {
    const sortValue = sortBy || SortByEnum.USAGE_COUNT;
    switch (sortValue) {
      case SortByEnum.USAGE_COUNT:
      case 'usageCount':
        return { usageCount: 'desc' };
      case SortByEnum.FAVORITE_COUNT:
      case 'favoriteCount':
        return { favoriteCount: 'desc' };
      case SortByEnum.LAST_USED_AT:
      case 'lastUsedAt':
        // 对于 lastUsedAt，只按 lastUsedAt 排序
        // 在 PostgreSQL 中，null 值在降序排序时会自动排在最后
        // 如果遇到问题，可以在应用层进行二次排序
        return { lastUsedAt: 'desc' };
      default:
        return { usageCount: 'desc' };
    }
  }
}
