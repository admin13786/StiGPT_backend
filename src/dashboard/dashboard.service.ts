import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { monitorEventLoopDelay } from 'perf_hooks';
import * as os from 'os';
import { CacheService } from '../common/cache/cache.service';
import { AppLogger } from '../common/logger/app-logger.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardService {
  private readonly cachePrefix = 'cache:dashboard:';
  private readonly shortCacheTtlSeconds: number;
  private readonly snapshotTtlSeconds: number;
  private readonly degradedTtlSeconds: number;
  private readonly degradeEventLoopMs: number;
  private readonly degradeLoadRatio: number;
  private readonly degradeQueryMs: number;
  private readonly degradedKey: string;
  private lastDegradedAt = 0;
  private readonly eventLoopMonitor = monitorEventLoopDelay({
    resolution: 20,
  });

  constructor(
    private prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.shortCacheTtlSeconds = this.getNumber('DASHBOARD_CACHE_TTL_SECONDS', 60);
    this.snapshotTtlSeconds = this.getNumber(
      'DASHBOARD_SNAPSHOT_TTL_SECONDS',
      300,
    );
    this.degradedTtlSeconds = this.getNumber(
      'DASHBOARD_DEGRADED_TTL_SECONDS',
      300,
    );
    this.degradeEventLoopMs = this.getNumber(
      'DASHBOARD_DEGRADE_EVENT_LOOP_MS',
      200,
    );
    this.degradeLoadRatio = this.getNumber(
      'DASHBOARD_DEGRADE_CPU_LOAD_RATIO',
      1.2,
    );
    this.degradeQueryMs = this.getNumber('DASHBOARD_DEGRADE_QUERY_MS', 1500);
    this.degradedKey = `${this.cachePrefix}degraded`;
    this.logger.setContext(DashboardService.name);
    this.eventLoopMonitor.enable();
  }

  /**
   * 使用原生 SQL 计算平均解决时间（秒）
   * 优化：避免加载所有工单数据到应用层
   */
  private async getAvgResolutionTime(
    ticketWhere: Prisma.TicketWhereInput,
  ): Promise<number> {
    const gameIdCondition = ticketWhere.gameId
      ? Prisma.sql`AND "gameId" = ${ticketWhere.gameId}`
      : Prisma.empty;

    const result = await this.prisma.$queryRaw<
      [{ avg_seconds: number | null }]
    >`
      SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt"))) as avg_seconds
      FROM "Ticket"
      WHERE "deletedAt" IS NULL
        AND "status" = 'RESOLVED'
        AND "closedAt" IS NOT NULL
        AND "createdAt" >= ${(ticketWhere.createdAt as any).gte}
        AND "createdAt" <= ${(ticketWhere.createdAt as any).lte}
        ${gameIdCondition}
    `;

    return Math.round(result[0]?.avg_seconds || 0);
  }

  /**
   * 使用原生 SQL 计算平均响应时间（秒）
   * 优化：避免加载所有会话数据到应用层
   */
  private async getAvgResponseTime(
    sessionWhere: any,
    gameId?: string,
  ): Promise<number> {
    const gameIdCondition = gameId
      ? Prisma.sql`AND t."gameId" = ${gameId}`
      : Prisma.empty;

    const result = await this.prisma.$queryRaw<
      [{ avg_seconds: number | null }]
    >`
      SELECT AVG(EXTRACT(EPOCH FROM (s."startedAt" - s."queuedAt"))) as avg_seconds
      FROM "Session" s
      JOIN "Ticket" t ON s."ticketId" = t.id
      WHERE t."deletedAt" IS NULL
        AND s."queuedAt" IS NOT NULL
        AND s."startedAt" IS NOT NULL
        AND s."createdAt" >= ${sessionWhere.createdAt.gte}
        AND s."createdAt" <= ${sessionWhere.createdAt.lte}
        ${gameIdCondition}
    `;

    return Math.round(result[0]?.avg_seconds || 0);
  }

  /**
   * 使用 aggregate 计算平均满意度
   * 优化：避免加载所有评分数据到应用层
   */
  private async getAvgSatisfaction(
    createdAt: { gte: Date; lte: Date },
    gameId?: string,
  ): Promise<{
    average: number;
    ratings: { rating: number; createdAt: Date }[];
  }> {
    const [aggregate, ratings] = await Promise.all([
      this.prisma.satisfactionRating.aggregate({
        _avg: { rating: true },
        _count: { rating: true },
        where: {
          createdAt,
          ticket: gameId ? { gameId } : undefined,
        },
      }),
      // 仍需获取每日评分用于 dailyStats
      this.prisma.satisfactionRating.findMany({
        where: {
          createdAt,
          ticket: gameId ? { gameId } : undefined,
        },
        select: {
          rating: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      average: aggregate._avg.rating
        ? Math.round(aggregate._avg.rating * 100) / 100
        : 0,
      ratings,
    };
  }

  private normalizeDate(date: Date) {
    const normalized = new Date(date);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private getNumber(key: string, fallback: number): number {
    const raw = this.configService.get<number | string>(key);
    const value = Number(raw ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private normalizeRange(startDate?: Date, endDate?: Date) {
    const dateStart = this.normalizeDate(
      startDate ?? new Date(Date.now() - 6 * MS_PER_DAY),
    );
    const dateEnd = this.normalizeDate(endDate ?? new Date());
    return { dateStart, dateEnd };
  }

  private buildCacheKeys(gameId: string | undefined, dateStart: Date, dateEnd: Date) {
    const gameKey = gameId || 'all';
    const startKey = this.formatDate(dateStart);
    const endKey = this.formatDate(dateEnd);
    const baseKey = `${gameKey}:${startKey}:${endKey}`;
    return {
      cacheKey: `${this.cachePrefix}metrics:${baseKey}`,
      snapshotKey: `${this.cachePrefix}snapshot:${baseKey}`,
    };
  }

  private getLoadRatio(): number {
    const cpuCount = Math.max(1, os.cpus().length);
    return os.loadavg()[0] / cpuCount;
  }

  private getEventLoopDelayMs(): number {
    const mean = this.eventLoopMonitor.mean / 1e6;
    this.eventLoopMonitor.reset();
    return mean;
  }

  private isManualDegraded(): boolean {
    return this.configService.get<string>('DASHBOARD_DEGRADED') === 'true';
  }

  private async markDegraded(reason: string) {
    await this.cacheService.setJson(
      this.degradedKey,
      true,
      this.degradedTtlSeconds,
    );
    const now = Date.now();
    if (now - this.lastDegradedAt > 60000) {
      this.logger.warn(`Dashboard degraded: ${reason}`);
      this.lastDegradedAt = now;
    }
  }

  private async shouldUseSnapshot(): Promise<boolean> {
    if (this.isManualDegraded()) {
      return true;
    }
    const cached = await this.cacheService.getJson<boolean>(this.degradedKey);
    if (cached) {
      return true;
    }
    const loadRatio = this.getLoadRatio();
    const eventLoopDelayMs = this.getEventLoopDelayMs();
    if (
      loadRatio >= this.degradeLoadRatio ||
      eventLoopDelayMs >= this.degradeEventLoopMs
    ) {
      await this.markDegraded(
        `load_ratio=${loadRatio.toFixed(2)} delay_ms=${Math.round(
          eventLoopDelayMs,
        )}`,
      );
      return true;
    }
    return false;
  }

  @Cron('*/5 * * * *')
  async refreshSnapshot() {
    try {
      const { dateStart, dateEnd } = this.normalizeRange();
      const { snapshotKey } = this.buildCacheKeys(undefined, dateStart, dateEnd);
      const result = await this.computeMetrics(undefined, dateStart, dateEnd);
      await this.cacheService.setJson(
        snapshotKey,
        result,
        this.snapshotTtlSeconds,
      );
    } catch (error) {
      this.logger.warn('Dashboard snapshot refresh failed');
    }
  }

  async getMetrics(gameId?: string, startDate?: Date, endDate?: Date) {
    const { dateStart, dateEnd } = this.normalizeRange(startDate, endDate);
    const { cacheKey, snapshotKey } = this.buildCacheKeys(
      gameId,
      dateStart,
      dateEnd,
    );

    const cached = await this.cacheService.getJson<any>(cacheKey);
    if (cached) {
      return cached;
    }

    if (await this.shouldUseSnapshot()) {
      const snapshot = await this.cacheService.getJson<any>(snapshotKey);
      if (snapshot) {
        return snapshot;
      }
    }

    const startedAt = Date.now();
    try {
      const result = await this.computeMetrics(gameId, dateStart, dateEnd);
      await this.cacheService.setJson(
        cacheKey,
        result,
        this.shortCacheTtlSeconds,
      );
      await this.cacheService.setJson(
        snapshotKey,
        result,
        this.snapshotTtlSeconds,
      );
      const durationMs = Date.now() - startedAt;
      if (durationMs >= this.degradeQueryMs) {
        await this.markDegraded(`query_ms=${durationMs}`);
      }
      return result;
    } catch (error) {
      this.logger.error(
        'Dashboard metrics failed',
        error instanceof Error ? error.stack : undefined,
      );
      const snapshot = await this.cacheService.getJson<any>(snapshotKey);
      if (snapshot) {
        return snapshot;
      }
      throw error;
    }
  }

  private async computeMetrics(
    gameId: string | undefined,
    dateStart: Date,
    dateEnd: Date,
  ) {
    const ticketWhere: any = {
      deletedAt: null,
    };
    if (gameId) ticketWhere.gameId = gameId;
    ticketWhere.createdAt = {
      gte: dateStart,
      lte: new Date(dateEnd.getTime() + MS_PER_DAY - 1),
    };

    const sessionWhere: any = {
      ticket: {
        deletedAt: null,
        ...(gameId ? { gameId } : {}),
      },
      createdAt: {
        gte: dateStart,
        lte: new Date(dateEnd.getTime() + MS_PER_DAY - 1),
      },
    };

    // P0 性能优化：使用数据库聚合替代应用层计算
    const [
      totalSessions,
      aiResolvedSessions,
      transferredSessions,
      totalTickets,
      openTickets,
      closedTickets,
      avgResolutionSeconds,
      avgResponseSeconds,
      satisfactionResult,
      agentSessions,
      agentRatings,
      ticketsForDaily,
    ] = await Promise.all([
      this.prisma.session.count({ where: sessionWhere }),
      this.prisma.session.count({
        where: {
          ...sessionWhere,
          status: 'CLOSED',
          agentId: null,
        },
      }),
      this.prisma.session.count({
        where: {
          ...sessionWhere,
          status: { in: ['IN_PROGRESS', 'CLOSED'] },
          agentId: { not: null },
        },
      }),
      this.prisma.ticket.count({ where: ticketWhere }),
      this.prisma.ticket.count({
        where: {
          ...ticketWhere,
          status: { not: 'RESOLVED' },
        },
      }),
      this.prisma.ticket.count({
        where: {
          ...ticketWhere,
          status: 'RESOLVED',
        },
      }),
      // 优化：使用原生 SQL 计算平均解决时间
      this.getAvgResolutionTime(ticketWhere),
      // 优化：使用原生 SQL 计算平均响应时间
      this.getAvgResponseTime(sessionWhere, gameId),
      // 优化：使用 aggregate 计算平均满意度
      this.getAvgSatisfaction(
        ticketWhere.createdAt as { gte: Date; lte: Date },
        gameId,
      ),
      this.prisma.session.findMany({
        where: {
          ...sessionWhere,
          agentId: { not: null },
        },
        select: {
          agentId: true,
          agent: {
            select: {
              username: true,
              realName: true,
              isOnline: true,
            },
          },
        },
      }),
      this.prisma.satisfactionRating.findMany({
        where: {
          agentId: { not: null },
          createdAt: ticketWhere.createdAt,
          ticket: gameId ? { gameId } : undefined,
        },
        select: {
          agentId: true,
          rating: true,
          agent: {
            select: {
              username: true,
              realName: true,
              isOnline: true,
            },
          },
        },
      }),
      this.prisma.ticket.findMany({
        where: ticketWhere,
        select: {
          createdAt: true,
          status: true,
        },
      }),
    ]);

    // 从优化后的结果中提取数据
    const satisfactionRatings = satisfactionResult.ratings;
    const averageSatisfaction = satisfactionResult.average;

    const dailyMap: Record<
      string,
      {
        tickets: number;
        resolved: number;
        ratingSum: number;
        ratingCount: number;
        totalSessions: number;
        aiResolvedSessions: number;
        transferredSessions: number;
      }
    > = {};
    for (
      let ts = dateStart.getTime();
      ts <= dateEnd.getTime();
      ts += MS_PER_DAY
    ) {
      dailyMap[this.formatDate(new Date(ts))] = {
        tickets: 0,
        resolved: 0,
        ratingSum: 0,
        ratingCount: 0,
        totalSessions: 0,
        aiResolvedSessions: 0,
        transferredSessions: 0,
      };
    }

    ticketsForDaily.forEach((ticket) => {
      const key = this.formatDate(ticket.createdAt);
      if (!dailyMap[key]) {
        dailyMap[key] = {
          tickets: 0,
          resolved: 0,
          ratingSum: 0,
          ratingCount: 0,
          totalSessions: 0,
          aiResolvedSessions: 0,
          transferredSessions: 0,
        };
      }
      dailyMap[key].tickets += 1;
      if (ticket.status === 'RESOLVED') {
        dailyMap[key].resolved += 1;
      }
    });

    // 统计每日会话数据（用于计算 AI 拦截率）
    const sessionsForDaily = await this.prisma.session.findMany({
      where: {
        ...sessionWhere,
        status: 'CLOSED',
      },
      select: {
        id: true,
        createdAt: true,
        agentId: true,
        messages: {
          where: { senderType: 'AI' },
          take: 1,
          select: { id: true },
        },
      },
    });

    sessionsForDaily.forEach((session) => {
      const key = this.formatDate(session.createdAt);
      if (!dailyMap[key]) {
        dailyMap[key] = {
          tickets: 0,
          resolved: 0,
          ratingSum: 0,
          ratingCount: 0,
          totalSessions: 0,
          aiResolvedSessions: 0,
          transferredSessions: 0,
        };
      }
      dailyMap[key].totalSessions += 1;

      // 判断是否是 AI 解决的：没有 agentId 且有 AI 消息
      if (!session.agentId && session.messages.length > 0) {
        dailyMap[key].aiResolvedSessions += 1;
      }

      // 判断是否是转人工的：有 agentId
      if (session.agentId) {
        dailyMap[key].transferredSessions += 1;
      }
    });

    satisfactionRatings.forEach((rating) => {
      const key = this.formatDate(rating.createdAt);
      if (!dailyMap[key]) {
        dailyMap[key] = {
          tickets: 0,
          resolved: 0,
          ratingSum: 0,
          ratingCount: 0,
          totalSessions: 0,
          aiResolvedSessions: 0,
          transferredSessions: 0,
        };
      }
      dailyMap[key].ratingSum += rating.rating;
      dailyMap[key].ratingCount += 1;
    });

    const dailyStats = Object.keys(dailyMap)
      .sort()
      .map((date) => {
        const stat = dailyMap[date];
        return {
          date,
          tickets: stat.tickets,
          resolved: stat.resolved,
          avgSatisfaction:
            stat.ratingCount > 0
              ? Math.round((stat.ratingSum / stat.ratingCount) * 100) / 100
              : 0,
          aiInterceptionRate:
            stat.totalSessions > 0
              ? Math.round(
                  (stat.aiResolvedSessions / stat.totalSessions) * 10000,
                ) / 100
              : 0,
          transferRate:
            stat.totalSessions > 0
              ? Math.round(
                  (stat.transferredSessions / stat.totalSessions) * 10000,
                ) / 100
              : 0,
        };
      });

    const agentStatsMap = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        isOnline: boolean;
        handledTickets: number;
        ratingSum: number;
        ratingCount: number;
        ratingDistribution: Record<string, number>;
      }
    >();

    const ensureAgentEntry = (
      agentId: string,
      name?: string,
      online?: boolean,
    ) => {
      if (!agentStatsMap.has(agentId)) {
        agentStatsMap.set(agentId, {
          agentId,
          agentName: name ?? '客服',
          isOnline: online ?? false,
          handledTickets: 0,
          ratingSum: 0,
          ratingCount: 0,
          ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        });
      } else if (name || online !== undefined) {
        const entry = agentStatsMap.get(agentId)!;
        if (name) entry.agentName = name;
        if (online !== undefined) entry.isOnline = online;
      }
    };

    agentSessions.forEach((session) => {
      const agentId = session.agentId!;
      const name = session.agent?.realName || session.agent?.username || '客服';
      ensureAgentEntry(agentId, name, session.agent?.isOnline ?? false);
      agentStatsMap.get(agentId)!.handledTickets += 1;
    });

    agentRatings.forEach((rating) => {
      const agentId = rating.agentId!;
      const name = rating.agent?.realName || rating.agent?.username || '客服';
      ensureAgentEntry(agentId, name, rating.agent?.isOnline ?? false);
      const entry = agentStatsMap.get(agentId)!;
      entry.ratingSum += rating.rating;
      entry.ratingCount += 1;
      const key = rating.rating.toString();
      entry.ratingDistribution[key] = (entry.ratingDistribution[key] || 0) + 1;
    });

    const agentStats = Array.from(agentStatsMap.values()).map((entry) => ({
      agentId: entry.agentId,
      agentName: entry.agentName,
      handledTickets: entry.handledTickets,
      isOnline: entry.isOnline,
      totalRatings: entry.ratingCount,
      averageRating:
        entry.ratingCount > 0
          ? Math.round((entry.ratingSum / entry.ratingCount) * 100) / 100
          : 0,
      ratingDistribution: entry.ratingDistribution,
    }));

    // 计算AI拦截率 = (总会话数 - 转人工会话数) / 总会话数 * 100%
    const aiInterceptionRate =
      totalSessions > 0
        ? Math.round(
            ((totalSessions - transferredSessions) / totalSessions) * 10000,
          ) / 100
        : 0;

    return {
      totalTickets,
      openTickets,
      closedTickets,
      averageResponseTime: avgResponseSeconds,
      averageResolutionTime: avgResolutionSeconds,
      satisfactionRating: averageSatisfaction,
      aiInterceptionRate, // AI拦截率（百分比）
      agentStats,
      dailyStats,
    };
  }
}
