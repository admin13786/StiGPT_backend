import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import {
  queueLengthGauge,
  redisConnectionErrorsCounter,
} from '../metrics/queue.metrics';
import { AppLogger } from '../common/logger/app-logger.service';

/**
 * 排队服务 - 使用 Redis Zset 管理排队序列
 */
@Injectable()
export class QueueService {
  private readonly QUEUE_PREFIX = 'queue:';
  private readonly UNASSIGNED_QUEUE_KEY = `${this.QUEUE_PREFIX}unassigned`;
  private readonly AGENT_QUEUE_KEY_PREFIX = `${this.QUEUE_PREFIX}agent:`;
  private _redisUnavailableLogged = false;

  // 从配置读取的参数
  private readonly retryDelayBase: number;
  private readonly retryDelayMax: number;
  private readonly defaultMaxRetries: number;
  private readonly pingTimeout: number;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(QueueService.name);
    this.retryDelayBase = this.configService.get<number>(
      'QUEUE_RETRY_DELAY_BASE',
      1000,
    );
    this.retryDelayMax = this.configService.get<number>(
      'QUEUE_RETRY_DELAY_MAX',
      4000,
    );
    this.defaultMaxRetries = this.configService.get<number>(
      'QUEUE_MAX_RETRIES',
      3,
    );
    this.pingTimeout = this.configService.get<number>('REDIS_PING_TIMEOUT', 2000);
  }

  /**
   * 分类 Redis 错误类型并记录指标
   */
  private recordRedisError(error: unknown): void {
    const errorMsg =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    let errorType: string;
    if (errorMsg.includes('timeout')) {
      errorType = 'timeout';
    } else if (
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('connection')
    ) {
      errorType = 'connection_refused';
    } else if (errorMsg.includes('maxretriesperrequest')) {
      errorType = 'max_retries';
    } else {
      errorType = 'other';
    }

    redisConnectionErrorsCounter.inc({ error_type: errorType });
  }

  /**
   * 检查是否为连接错误（需要快速失败，不重试）
   */
  private isConnectionError(error: Error): boolean {
    const errorMsg = error.message.toLowerCase();
    return (
      errorMsg.includes('maxretriesperrequest') ||
      errorMsg.includes('connection') ||
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('timeout')
    );
  }

  /**
   * 通用重试包装器
   * @param operation 要执行的操作
   * @param operationName 操作名称（用于日志）
   * @param sessionId 会话ID（用于日志）
   * @param maxRetries 最大重试次数
   * @param allowFailOnConnectionError 连接错误时是否允许静默失败
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    sessionId: string,
    maxRetries = 3,
    allowFailOnConnectionError = false,
  ): Promise<{ success: boolean; result?: T }> {
    // 先快速检查 Redis 是否可用
    const isAvailable = await this.isRedisAvailable();
    if (!isAvailable) {
      if (allowFailOnConnectionError) {
        this.logger.debug(
          `Redis 不可用，跳过${operationName}（会话 ${sessionId}）`,
        );
        return { success: true }; // 静默成功
      }
      this.logger.warn(
        `Redis 不可用，跳过${operationName}（会话 ${sessionId}），将在一致性检查时恢复`,
      );
      return { success: false };
    }

    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await operation();
        return { success: true, result };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 如果是连接错误，快速失败
        if (this.isConnectionError(lastError)) {
          if (allowFailOnConnectionError) {
            this.logger.debug(
              `Redis 连接错误，跳过${operationName}（会话 ${sessionId}）: ${lastError.message}`,
            );
            return { success: true }; // 静默成功
          }
          this.logger.warn(
            `Redis 连接错误，快速失败（会话 ${sessionId}）: ${lastError.message}`,
          );
          return { success: false };
        }

        if (i < maxRetries - 1) {
          // 指数退避
          const delay = Math.min(
            this.retryDelayBase * Math.pow(2, i),
            this.retryDelayMax,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          this.logger.warn(
            `${operationName}失败，${delay}ms 后重试 (${i + 1}/${maxRetries}): ${lastError.message}`,
          );
        }
      }
    }

    // 所有重试都失败
    if (allowFailOnConnectionError) {
      this.logger.warn(
        `${operationName}失败（已重试${maxRetries}次），但可以忽略: ${lastError?.message}`,
      );
      return { success: true };
    }

    this.logger.error(
      `${operationName}失败（已重试${maxRetries}次）: ${lastError?.message}`,
      lastError?.stack,
    );
    return { success: false };
  }

  /**
   * 计算会话的排序分数
   * 分数 = priorityScore * 10^10 + (10^13 - timestamp)
   */
  private calculateScore(priorityScore: number, queuedAt: Date): number {
    const timestamp = queuedAt.getTime();
    const maxTimestamp = 9999999999999;
    const safePriorityScore = Math.max(0, priorityScore || 0);
    const safeTimestamp = Math.max(0, Math.min(timestamp, maxTimestamp));
    return safePriorityScore * 10000000000 + (maxTimestamp - safeTimestamp);
  }

  /**
   * 添加会话到未分配队列
   */
  async addToUnassignedQueue(
    sessionId: string,
    priorityScore: number,
    queuedAt: Date,
  ): Promise<void> {
    try {
      const score = this.calculateScore(priorityScore, queuedAt);
      await this.redis.zadd(this.UNASSIGNED_QUEUE_KEY, score, sessionId);
      this.logger.debug(`添加会话 ${sessionId} 到未分配队列，分数: ${score}`);
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`添加会话到未分配队列失败: ${errorMsg}`, errorStack);
      throw error;
    }
  }

  /**
   * 添加会话到指定客服的队列
   */
  async addToAgentQueue(
    sessionId: string,
    agentId: string,
    priorityScore: number,
    queuedAt: Date,
  ): Promise<void> {
    try {
      const score = this.calculateScore(priorityScore, queuedAt);
      const queueKey = `${this.AGENT_QUEUE_KEY_PREFIX}${agentId}`;
      await this.redis.zadd(queueKey, score, sessionId);
      this.logger.debug(
        `添加会话 ${sessionId} 到客服 ${agentId} 的队列，分数: ${score}`,
      );
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`添加会话到客服队列失败: ${errorMsg}`, errorStack);
      throw error;
    }
  }

  /**
   * 从队列中移除会话
   */
  async removeFromQueue(
    sessionId: string,
    agentId?: string | null,
  ): Promise<void> {
    try {
      // 从未分配队列移除
      await this.redis.zrem(this.UNASSIGNED_QUEUE_KEY, sessionId);

      // 如果指定了 agentId，也从该客服的队列移除
      if (agentId) {
        const queueKey = `${this.AGENT_QUEUE_KEY_PREFIX}${agentId}`;
        await this.redis.zrem(queueKey, sessionId);
      } else {
        // 如果没有指定 agentId，尝试从所有客服队列中移除
        const keys = await this.scanAgentQueueKeys();
        if (keys.length > 0) {
          await Promise.all(keys.map((key) => this.redis.zrem(key, sessionId)));
        }
      }

      this.logger.debug(`从队列移除会话 ${sessionId}`);
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`从队列移除会话失败: ${errorMsg}`, errorStack);
      throw error;
    }
  }

  /**
   * 扫描所有客服队列的 key
   */
  private async scanAgentQueueKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.AGENT_QUEUE_KEY_PREFIX}*`,
        'COUNT',
        100,
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
  }

  /**
   * 将会话从未分配队列移动到指定客服的队列
   */
  async moveToAgentQueue(
    sessionId: string,
    agentId: string,
    priorityScore: number,
    queuedAt: Date,
  ): Promise<void> {
    try {
      // 从未分配队列移除
      try {
        await this.redis.zrem(this.UNASSIGNED_QUEUE_KEY, sessionId);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `从未分配队列移除会话失败（可能本来就不在队列中）: ${errorMsg}`,
        );
      }

      // 添加到客服队列
      await this.addToAgentQueue(sessionId, agentId, priorityScore, queuedAt);

      this.logger.debug(
        `将会话 ${sessionId} 从未分配队列移动到客服 ${agentId} 的队列`,
      );
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`移动会话到客服队列失败: ${errorMsg}`, errorStack);
      throw error;
    }
  }

  /**
   * 获取会话在队列中的位置（排名，从1开始）
   */
  async getQueuePosition(
    sessionId: string,
    agentId?: string | null,
  ): Promise<number | null> {
    try {
      const queueKey = agentId
        ? `${this.AGENT_QUEUE_KEY_PREFIX}${agentId}`
        : this.UNASSIGNED_QUEUE_KEY;

      const rank = await this.redis.zrevrank(queueKey, sessionId);
      if (rank === null) {
        return null;
      }
      return rank + 1;
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`获取排队位置失败: ${errorMsg}`, errorStack);
      return null;
    }
  }

  /**
   * 获取队列中的所有会话ID（按优先级和时间排序）
   */
  async getQueueSessionIds(
    agentId?: string | null,
    limit?: number,
  ): Promise<string[]> {
    try {
      const queueKey = agentId
        ? `${this.AGENT_QUEUE_KEY_PREFIX}${agentId}`
        : this.UNASSIGNED_QUEUE_KEY;

      return await this.redis.zrevrange(queueKey, 0, limit ? limit - 1 : -1);
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`获取队列会话ID失败: ${errorMsg}`, errorStack);
      return [];
    }
  }

  /**
   * 获取队列长度
   */
  async getQueueLength(agentId?: string | null): Promise<number> {
    try {
      const queueKey = agentId
        ? `${this.AGENT_QUEUE_KEY_PREFIX}${agentId}`
        : this.UNASSIGNED_QUEUE_KEY;
      const queueType = agentId ? 'agent' : 'unassigned';

      const length = await this.redis.zcard(queueKey);
      queueLengthGauge.set({ queue_type: queueType }, length);
      return length;
    } catch (error: unknown) {
      this.recordRedisError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`获取队列长度失败: ${errorMsg}`, errorStack);
      return 0;
    }
  }

  /**
   * 检查 Redis 是否可用
   */
  async isRedisAvailable(): Promise<boolean> {
    try {
      const result = await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis ping timeout')),
            this.pingTimeout,
          ),
        ),
      ]);
      this._redisUnavailableLogged = false;
      return result === 'PONG';
    } catch (error) {
      this.recordRedisError(error);
      if (!this._redisUnavailableLogged) {
        this.logger.warn(
          `Redis 不可用: ${error instanceof Error ? error.message : String(error)}`,
        );
        this._redisUnavailableLogged = true;
      }
      return false;
    }
  }

  // ================== 带重试的方法（使用通用重试包装器）==================

  /**
   * 带重试的添加会话到未分配队列
   */
  async addToUnassignedQueueWithRetry(
    sessionId: string,
    priorityScore: number,
    queuedAt: Date,
    maxRetries?: number,
  ): Promise<boolean> {
    const retries = maxRetries ?? this.defaultMaxRetries;
    const result = await this.withRetry(
      () => this.addToUnassignedQueue(sessionId, priorityScore, queuedAt),
      '添加会话到未分配队列',
      sessionId,
      retries,
    );
    return result.success;
  }

  /**
   * 带重试的添加会话到指定客服的队列
   */
  async addToAgentQueueWithRetry(
    sessionId: string,
    agentId: string,
    priorityScore: number,
    queuedAt: Date,
    maxRetries?: number,
  ): Promise<boolean> {
    const retries = maxRetries ?? this.defaultMaxRetries;
    const result = await this.withRetry(
      () => this.addToAgentQueue(sessionId, agentId, priorityScore, queuedAt),
      '添加会话到客服队列',
      sessionId,
      retries,
    );
    return result.success;
  }

  /**
   * 带重试的从队列中移除会话
   */
  async removeFromQueueWithRetry(
    sessionId: string,
    agentId?: string | null,
    maxRetries?: number,
  ): Promise<boolean> {
    const retries = maxRetries ?? this.defaultMaxRetries;
    const result = await this.withRetry(
      () => this.removeFromQueue(sessionId, agentId),
      '从队列移除会话',
      sessionId,
      retries,
      true, // 移除操作失败可以忽略
    );
    return result.success;
  }

  /**
   * 带重试的将会话从未分配队列移动到指定客服的队列
   */
  async moveToAgentQueueWithRetry(
    sessionId: string,
    agentId: string,
    priorityScore: number,
    queuedAt: Date,
    maxRetries?: number,
  ): Promise<boolean> {
    const retries = maxRetries ?? this.defaultMaxRetries;
    const result = await this.withRetry(
      () => this.moveToAgentQueue(sessionId, agentId, priorityScore, queuedAt),
      '移动会话到客服队列',
      sessionId,
      retries,
    );
    return result.success;
  }

  // ================== 数据恢复与同步 ==================

  /**
   * 从数据库恢复队列数据到 Redis
   */
  async recoverQueueFromDatabase(): Promise<void> {
    try {
      this.logger.debug('开始从数据库恢复队列数据到 Redis...');

      if (!(await this.isRedisAvailable())) {
        this.logger.warn('Redis 不可用，跳过队列数据恢复');
        return;
      }

      // 检查数据库表是否存在
      if (!(await this.isSessionTableAvailable())) {
        return;
      }

      // 获取所有排队状态的会话
      const queuedSessions = await this.prisma.session.findMany({
        where: { status: 'QUEUED' },
        select: {
          id: true,
          agentId: true,
          priorityScore: true,
          queuedAt: true,
        },
      });

      if (queuedSessions.length === 0) {
        this.logger.debug('没有排队状态的会话，跳过恢复');
        return;
      }

      // 恢复未分配的会话
      const unassignedSessions = queuedSessions.filter((s) => !s.agentId);
      for (const session of unassignedSessions) {
        if (session.queuedAt) {
          await this.addToUnassignedQueueWithRetry(
            session.id,
            session.priorityScore || 0,
            session.queuedAt,
          );
        }
      }

      // 恢复已分配的会话（按客服分组）
      const assignedSessions = queuedSessions.filter((s) => s.agentId);
      const sessionsByAgent = this.groupSessionsByAgent(assignedSessions);

      for (const [agentId, sessions] of sessionsByAgent.entries()) {
        for (const session of sessions) {
          if (session.queuedAt) {
            await this.addToAgentQueueWithRetry(
              session.id,
              agentId,
              session.priorityScore || 0,
              session.queuedAt,
            );
          }
        }
      }

      this.logger.log(
        `队列数据恢复完成：未分配 ${unassignedSessions.length} 个，已分配 ${assignedSessions.length} 个`,
      );
    } catch (error: any) {
      if (this.isTableNotExistError(error)) {
        this.logger.warn(
          '数据库表不存在，可能是数据库迁移尚未执行，跳过队列数据恢复',
        );
        return;
      }
      this.logger.error(
        `从数据库恢复队列数据失败: ${error?.message || String(error)}`,
        error?.stack,
      );
    }
  }

  /**
   * 同步 Redis 队列数据到数据库
   */
  async syncQueueToDatabase(): Promise<void> {
    try {
      if (!(await this.isRedisAvailable())) {
        return;
      }

      if (!(await this.isSessionTableAvailable())) {
        return;
      }

      const queuedSessions = await this.prisma.session.findMany({
        where: { status: 'QUEUED' },
        select: { id: true, agentId: true },
      });

      for (const session of queuedSessions) {
        const queuePosition = await this.getQueuePosition(
          session.id,
          session.agentId,
        );
        if (queuePosition !== null) {
          await this.prisma.session.update({
            where: { id: session.id },
            data: { queuePosition },
          });
        }
      }

      this.logger.debug(
        `同步队列数据到数据库完成，更新了 ${queuedSessions.length} 个会话`,
      );
    } catch (error: any) {
      if (this.isTableNotExistError(error)) {
        return;
      }
      this.logger.error(
        `同步队列数据到数据库失败: ${error?.message || String(error)}`,
        error?.stack,
      );
    }
  }

  // ================== 辅助方法 ==================

  /**
   * 检查 Session 表是否可用
   */
  private async isSessionTableAvailable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM "Session" LIMIT 1`;
      return true;
    } catch (error: any) {
      if (this.isTableNotExistError(error)) {
        this.logger.warn(
          'Session 表不存在，可能是数据库迁移尚未执行，跳过操作',
        );
        return false;
      }
      throw error;
    }
  }

  /**
   * 检查是否为表不存在错误
   */
  private isTableNotExistError(error: any): boolean {
    return (
      error?.message?.includes('does not exist') ||
      error?.code === '42P01' ||
      error?.message?.includes('Table') ||
      error?.message?.includes('table')
    );
  }

  /**
   * 按客服分组会话
   */
  private groupSessionsByAgent(
    sessions: Array<{ id: string; agentId: string | null; priorityScore: number | null; queuedAt: Date | null }>,
  ): Map<string, typeof sessions> {
    const map = new Map<string, typeof sessions>();
    for (const session of sessions) {
      if (session.agentId) {
        if (!map.has(session.agentId)) {
          map.set(session.agentId, []);
        }
        map.get(session.agentId)!.push(session);
      }
    }
    return map;
  }
}
