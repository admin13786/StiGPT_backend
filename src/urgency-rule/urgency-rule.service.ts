import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ErrorCodes } from '../common/exceptions';
import {
  CreateUrgencyRuleDto,
  UpdateUrgencyRuleDto,
} from './dto/create-urgency-rule.dto';
import { CacheService } from '../common/cache/cache.service';

@Injectable()
export class UrgencyRuleService {
  private readonly cachePrefix = 'cache:urgency-rule:';
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

  private async getEnabledRules() {
    const cacheKey = `${this.cachePrefix}enabled`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.urgencyRule.findMany({
        where: { enabled: true, deletedAt: null },
      }),
    );
  }

  // 获取所有规则
  async findAll() {
    const cacheKey = `${this.cachePrefix}all`;
    return this.cacheService.getOrSet(cacheKey, this.cacheTtlSeconds, () =>
      this.prisma.urgencyRule.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  // 获取单个规则
  async findOne(id: string) {
    const rule = await this.prisma.urgencyRule.findUnique({
      where: { id, deletedAt: null },
    });

    if (!rule) {
      throw new BusinessException(ErrorCodes.SYSTEM_VALIDATION_ERROR, '规则不存在');
    }

    return rule;
  }

  // 创建规则
  async create(createUrgencyRuleDto: CreateUrgencyRuleDto) {
    const created = await this.prisma.urgencyRule.create({
      data: {
        ...createUrgencyRuleDto,
        conditions: createUrgencyRuleDto.conditions as any,
      },
    });
    await this.clearCache();
    return created;
  }

  // 更新规则
  async update(id: string, updateUrgencyRuleDto: UpdateUrgencyRuleDto) {
    await this.findOne(id);
    const updated = await this.prisma.urgencyRule.update({
      where: { id },
      data: {
        ...updateUrgencyRuleDto,
        conditions: updateUrgencyRuleDto.conditions
          ? (updateUrgencyRuleDto.conditions as any)
          : undefined,
      },
    });
    await this.clearCache();
    return updated;
  }

  // 删除规则
  async remove(id: string) {
    await this.findOne(id);
    const removed = await this.prisma.urgencyRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.clearCache();
    return removed;
  }

  // 重新计算队列排序
  async recalculateQueue() {
    const queuedSessions = await this.prisma.session.findMany({
      where: { status: 'QUEUED' },
      include: { ticket: true },
    });

    const rules = await this.getEnabledRules();

    for (const session of queuedSessions) {
      let totalScore = 0;

      for (const rule of rules) {
        const matches = await this.matchRule(
          rule.conditions as any,
          session.ticket,
          session,
        );
        if (matches) {
          totalScore += rule.priorityWeight;
        }
      }

      await this.prisma.session.update({
        where: { id: session.id },
        data: { priorityScore: totalScore },
      });
    }

    // 重新排序
    await this.reorderQueue();

    return { message: '队列排序已重新计算' };
  }

  private async matchRule(
    conditions: any,
    ticket: any,
    session: any,
  ): Promise<boolean> {
    // 问题类型匹配是必需的（核心匹配条件）
    if (
      !conditions.issueTypeIds ||
      !Array.isArray(conditions.issueTypeIds) ||
      conditions.issueTypeIds.length === 0
    ) {
      return false;
    }

    // 获取工单的问题类型
    const ticketIssueTypes = await this.prisma.ticketIssueType.findMany({
      where: { ticketId: ticket.id },
      select: { issueTypeId: true },
    });
    const ticketIssueTypeIds = ticketIssueTypes.map((t) => t.issueTypeId);

    // 检查工单是否包含规则中指定的任何问题类型
    const hasMatchingIssueType = conditions.issueTypeIds.some((id: string) =>
      ticketIssueTypeIds.includes(id),
    );

    if (!hasMatchingIssueType) {
      return false;
    }

    // 以下为可选的附加匹配条件（用于更精确的匹配）
    if (
      conditions.keywords &&
      Array.isArray(conditions.keywords) &&
      conditions.keywords.length > 0
    ) {
      const matches = conditions.keywords.some((keyword: string) =>
        ticket.description.toLowerCase().includes(keyword.toLowerCase()),
      );
      if (!matches) return false;
    }

    if (conditions.intent && session.detectedIntent !== conditions.intent) {
      return false;
    }

    if (
      conditions.identityStatus &&
      ticket.identityStatus !== conditions.identityStatus
    ) {
      return false;
    }

    if (conditions.gameId && ticket.gameId !== conditions.gameId) {
      return false;
    }

    if (conditions.serverId && ticket.serverId !== conditions.serverId) {
      return false;
    }

    if (conditions.priority && ticket.priority !== conditions.priority) {
      return false;
    }

    return true;
  }

  private async reorderQueue() {
    const queuedSessions = await this.prisma.session.findMany({
      where: { status: 'QUEUED' },
      orderBy: [{ priorityScore: 'desc' }, { queuedAt: 'asc' }],
    });

    for (let i = 0; i < queuedSessions.length; i++) {
      await this.prisma.session.update({
        where: { id: queuedSessions[i].id },
        data: { queuePosition: i + 1 },
      });
    }
  }
}
