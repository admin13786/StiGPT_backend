import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis 日志缓冲服务
 *
 * 职责：
 * 1. 将日志异步写入 Redis 队列
 * 2. 提供降级机制（Redis 不可用时返回 false）
 * 3. 监控队列长度，防止内存溢出
 */
@Injectable()
export class RedisLogBufferService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private isEnabled: boolean;
  private redisKey: string;
  private maxSize: number;
  private isConnected = false;

  constructor() {
    this.isEnabled = process.env.LOG_USE_REDIS_BUFFER === 'true';
    this.redisKey = process.env.LOG_REDIS_KEY || 'system:logs:buffer';
    this.maxSize = parseInt(process.env.LOG_REDIS_MAX_SIZE || '10000');

    if (this.isEnabled) {
      this.initRedis();
    }
  }

  private initRedis() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        console.log('[RedisLogBuffer] Connected to Redis');
      });

      this.redis.on('error', (err) => {
        this.isConnected = false;
        console.error('[RedisLogBuffer] Redis error:', err.message);
      });

      this.redis.on('close', () => {
        this.isConnected = false;
        console.warn('[RedisLogBuffer] Redis connection closed');
      });

      // 异步连接
      this.redis.connect().catch((err) => {
        console.error('[RedisLogBuffer] Failed to connect:', err.message);
      });
    } catch (error) {
      console.error('[RedisLogBuffer] Init failed:', error);
      this.redis = null;
    }
  }

  /**
   * 将日志推入 Redis 队列
   *
   * @param logLine 日志字符串（JSON 格式）
   * @returns 是否成功写入 Redis（失败时调用方应降级到内存队列）
   */
  async pushLog(logLine: string): Promise<boolean> {
    if (!this.isEnabled || !this.redis || !this.isConnected) {
      return false;
    }

    try {
      // 检查队列长度，防止内存溢出
      const queueSize = await this.redis.llen(this.redisKey);
      if (queueSize >= this.maxSize) {
        console.warn(
          `[RedisLogBuffer] Queue full (${queueSize}/${this.maxSize}), dropping log`,
        );
        return false;
      }

      // LPUSH 到队列头部（消费者从尾部 RPOP）
      await this.redis.lpush(this.redisKey, logLine);
      return true;
    } catch (error) {
      console.error('[RedisLogBuffer] Push failed:', error);
      return false;
    }
  }

  /**
   * 获取 Redis 连接状态
   */
  isReady(): boolean {
    return this.isEnabled && this.isConnected;
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
