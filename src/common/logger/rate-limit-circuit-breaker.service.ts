import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 429 错误熔断器
 *
 * 职责：
 * 1. 监测连续的 429 错误
 * 2. 达到阈值后触发熔断（记录到 Redis）
 * 3. 熔断期间静默日志（只记录计数）
 * 4. 冷却期后自动恢复
 */
@Injectable()
export class RateLimitCircuitBreakerService {
  private redis: Redis | null = null;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly redisKey = 'system:circuit_breaker:rate_limit';
  private readonly counterKey = 'system:circuit_breaker:rate_limit:counter';

  // 内存降级（Redis 不可用时）
  private memoryCounter = 0;
  private memoryWindowStart = Date.now();
  private memoryCircuitOpen = false;
  private memoryCircuitOpenTime = 0;

  constructor() {
    this.threshold = parseInt(
      process.env.RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD || '5',
    );
    this.windowMs = parseInt(
      process.env.RATE_LIMIT_CIRCUIT_BREAKER_WINDOW || '60000',
    );
    this.cooldownMs = parseInt(
      process.env.RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN || '300000',
    );

    this.initRedis();
  }

  private initRedis() {
    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379');
      const redisUrl =
        process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redis.on('error', (err) => {
        console.error('[CircuitBreaker] Redis error:', err.message);
      });

      this.redis.connect().catch((err) => {
        console.error('[CircuitBreaker] Failed to connect:', err.message);
      });
    } catch (error) {
      console.error('[CircuitBreaker] Init failed:', error);
      this.redis = null;
    }
  }

  /**
   * 记录一次 429 错误
   * 如果达到阈值，触发熔断
   */
  async record429Error(): Promise<void> {
    if (this.redis && this.redis.status === 'ready') {
      await this.record429ErrorRedis();
    } else {
      this.record429ErrorMemory();
    }
  }

  private async record429ErrorRedis(): Promise<void> {
    try {
      const now = Date.now();

      // 使用 Redis 计数器（带过期时间）
      const count = await this.redis!.incr(this.counterKey);

      if (count === 1) {
        // 第一次计数，设置过期时间
        await this.redis!.pexpire(this.counterKey, this.windowMs);
      }

      // 检查是否达到阈值
      if (count >= this.threshold) {
        // 触发熔断
        await this.redis!.set(
          this.redisKey,
          now.toString(),
          'PX',
          this.cooldownMs,
        );
        console.warn(
          `[CircuitBreaker] Rate limit circuit opened (${count} errors in ${this.windowMs}ms)`,
        );
      }
    } catch (error) {
      console.error('[CircuitBreaker] Record failed:', error);
      // 降级到内存
      this.record429ErrorMemory();
    }
  }

  private record429ErrorMemory(): void {
    const now = Date.now();

    // 检查窗口是否过期
    if (now - this.memoryWindowStart > this.windowMs) {
      this.memoryCounter = 0;
      this.memoryWindowStart = now;
    }

    this.memoryCounter++;

    // 检查是否达到阈值
    if (this.memoryCounter >= this.threshold) {
      this.memoryCircuitOpen = true;
      this.memoryCircuitOpenTime = now;
      console.warn(
        `[CircuitBreaker] Rate limit circuit opened (memory fallback, ${this.memoryCounter} errors)`,
      );
    }
  }

  /**
   * 检查熔断器是否打开
   *
   * @returns true 表示熔断中（应静默日志），false 表示正常
   */
  async isCircuitOpen(): Promise<boolean> {
    if (this.redis && this.redis.status === 'ready') {
      return await this.isCircuitOpenRedis();
    } else {
      return this.isCircuitOpenMemory();
    }
  }

  private async isCircuitOpenRedis(): Promise<boolean> {
    try {
      const openTime = await this.redis!.get(this.redisKey);
      if (!openTime) {
        return false;
      }

      const now = Date.now();
      const elapsed = now - parseInt(openTime);

      // 检查是否还在冷却期
      if (elapsed < this.cooldownMs) {
        return true;
      }

      // 冷却期结束，删除熔断标记
      await this.redis!.del(this.redisKey);
      await this.redis!.del(this.counterKey);
      console.log(
        '[CircuitBreaker] Rate limit circuit closed (cooldown expired)',
      );
      return false;
    } catch (error) {
      console.error('[CircuitBreaker] Check failed:', error);
      return this.isCircuitOpenMemory();
    }
  }

  private isCircuitOpenMemory(): boolean {
    if (!this.memoryCircuitOpen) {
      return false;
    }

    const now = Date.now();
    const elapsed = now - this.memoryCircuitOpenTime;

    // 检查是否还在冷却期
    if (elapsed < this.cooldownMs) {
      return true;
    }

    // 冷却期结束
    this.memoryCircuitOpen = false;
    this.memoryCounter = 0;
    this.memoryWindowStart = now;
    console.log('[CircuitBreaker] Rate limit circuit closed (memory fallback)');
    return false;
  }

  /**
   * 获取当前熔断计数（用于监控）
   */
  async getSilencedCount(): Promise<number> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const count = await this.redis.get(`${this.redisKey}:silenced_count`);
        return count ? parseInt(count) : 0;
      } catch (error) {
        return 0;
      }
    }
    return 0;
  }

  /**
   * 增加静默计数
   */
  async incrementSilencedCount(): Promise<void> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.incr(`${this.redisKey}:silenced_count`);
        await this.redis.expire(`${this.redisKey}:silenced_count`, 3600); // 1小时过期
      } catch (error) {
        // 忽略错误
      }
    }
  }
}
