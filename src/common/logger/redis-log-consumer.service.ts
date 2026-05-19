/**
 * Redis 日志消费者服务
 *
 * 功能：
 * 1. 从 Redis 队列批量消费日志
 * 2. 写入本地文件或转发到 Loki
 * 3. 支持优雅关闭
 *
 * 配置：
 * - LOG_USE_REDIS_BUFFER: 启用 Redis 缓冲
 * - LOG_REDIS_KEY: Redis 队列键名
 * - LOG_CONSUMER_BATCH_SIZE: 批量消费大小
 * - LOG_CONSUMER_POLL_INTERVAL: 轮询间隔（毫秒）
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 简单的日期格式化
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable()
export class RedisLogConsumerService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;
  private isRunning = false;
  private isEnabled = false;

  // 配置
  private readonly redisKey: string;
  private readonly batchSize: number;
  private readonly pollInterval: number;
  private readonly logDir: string;

  // 日志流
  private combinedStream: NodeJS.WritableStream | null = null;
  private errorStream: NodeJS.WritableStream | null = null;
  private currentDate: string = '';

  // 统计
  private consumedCount = 0;
  private lastLogTime = 0;

  constructor() {
    this.isEnabled = process.env.LOG_USE_REDIS_BUFFER === 'true';
    this.redisKey = process.env.LOG_REDIS_KEY || 'system:logs:buffer';
    this.batchSize = parseInt(process.env.LOG_CONSUMER_BATCH_SIZE || '100');
    this.pollInterval = parseInt(
      process.env.LOG_CONSUMER_POLL_INTERVAL || '200',
    );
    this.logDir = process.env.LOG_DIR || join(process.cwd(), 'logs');
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      console.log('[RedisLogConsumer] Disabled (LOG_USE_REDIS_BUFFER != true)');
      return;
    }

    await this.initRedis();
    this.initLogStreams();
    this.startConsuming();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  /**
   * 初始化 Redis 连接
   */
  private async initRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 5) return null; // 停止重试
          return Math.min(times * 1000, 5000);
        },
        lazyConnect: true,
      });

      await this.redis.connect();
      console.log('[RedisLogConsumer] Connected to Redis');
    } catch (error) {
      console.error('[RedisLogConsumer] Failed to connect to Redis:', error);
      this.redis = null;
    }
  }

  /**
   * 初始化日志写入流
   */
  private initLogStreams(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.currentDate = formatDate(new Date());
    const combinedPath = join(this.logDir, `backend-${this.currentDate}.log`);
    const errorPath = join(
      this.logDir,
      `backend-${this.currentDate}.error.log`,
    );

    // 关闭旧流
    this.closeStreams();

    this.combinedStream = createWriteStream(combinedPath, {
      flags: 'a',
      highWaterMark: 128 * 1024,
    });

    this.errorStream = createWriteStream(errorPath, {
      flags: 'a',
      highWaterMark: 64 * 1024,
    });

    this.combinedStream.on('error', (err) => {
      console.error('[RedisLogConsumer] Combined stream error:', err);
    });

    this.errorStream.on('error', (err) => {
      console.error('[RedisLogConsumer] Error stream error:', err);
    });
  }

  private closeStreams(): void {
    if (this.combinedStream) {
      this.combinedStream.end();
      this.combinedStream = null;
    }
    if (this.errorStream) {
      this.errorStream.end();
      this.errorStream = null;
    }
  }

  /**
   * 开始消费循环
   */
  private async startConsuming(): Promise<void> {
    if (!this.redis) {
      console.error('[RedisLogConsumer] Redis not available, cannot start');
      return;
    }

    this.isRunning = true;
    console.log('[RedisLogConsumer] Started consuming logs');

    while (this.isRunning) {
      try {
        // 检查日期变化，需要轮转日志文件
        const today = formatDate(new Date());
        if (today !== this.currentDate) {
          this.initLogStreams();
        }

        // 批量获取日志
        const logs = await this.fetchLogs();

        if (logs.length > 0) {
          // 先写入文件
          await this.writeLogs(logs);
          // 写入成功后再从 Redis 删除（避免日志丢失）
          await this.confirmLogs(logs.length);
          this.consumedCount += logs.length;

          // 每消费 1000 条打印一次统计
          const now = Date.now();
          if (now - this.lastLogTime > 60000) {
            console.log(
              `[RedisLogConsumer] Consumed ${this.consumedCount} logs total`,
            );
            this.lastLogTime = now;
          }
        } else {
          // 队列空，休眠一段时间
          await this.sleep(this.pollInterval);
        }
      } catch (error) {
        console.error('[RedisLogConsumer] Error in consume loop:', error);
        await this.sleep(1000);
      }
    }
  }

  /**
   * 从 Redis 批量获取日志（仅读取，不删除）
   */
  private async fetchLogs(): Promise<string[]> {
    if (!this.redis) return [];

    try {
      // 仅读取日志，不立即删除（避免写入失败时丢失日志）
      const logs = await this.redis.lrange(this.redisKey, -this.batchSize, -1);

      if (logs && logs.length > 0) {
        // LRANGE 返回的是从尾部开始的，需要反转以保持时间顺序
        return logs.reverse();
      }

      return [];
    } catch (error) {
      console.error('[RedisLogConsumer] Failed to fetch logs:', error);
      return [];
    }
  }

  /**
   * 确认日志已写入，从 Redis 删除
   */
  private async confirmLogs(count: number): Promise<void> {
    if (!this.redis || count <= 0) return;

    try {
      // 删除已成功写入的日志
      await this.redis.ltrim(this.redisKey, 0, -(count + 1));
    } catch (error) {
      console.error('[RedisLogConsumer] Failed to confirm logs:', error);
    }
  }

  /**
   * 写入日志到文件
   */
  private async writeLogs(logs: string[]): Promise<void> {
    if (!this.combinedStream || !this.errorStream) return;

    const combinedContent: string[] = [];
    const errorContent: string[] = [];

    for (const log of logs) {
      combinedContent.push(log + '\n');

      // 检查是否是错误日志
      try {
        const parsed = JSON.parse(log);
        if (parsed.level === 'ERROR' || parsed.lv === 'ERROR') {
          errorContent.push(log + '\n');
        }
      } catch {
        // 非 JSON 格式，检查文本中是否包含 ERROR
        if (log.includes('ERROR')) {
          errorContent.push(log + '\n');
        }
      }
    }

    // 写入 combined 日志
    if (combinedContent.length > 0) {
      await this.writeToStream(this.combinedStream, combinedContent.join(''));
    }

    // 写入 error 日志
    if (errorContent.length > 0) {
      await this.writeToStream(this.errorStream, errorContent.join(''));
    }
  }

  private writeToStream(
    stream: NodeJS.WritableStream,
    content: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const canContinue = stream.write(content, 'utf8', (err) => {
        if (err) {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        } else {
          safeResolve();
        }
      });

      // 仅当缓冲区满且回调尚未触发时等待 drain
      if (!canContinue && !resolved) {
        stream.once('drain', safeResolve);
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 停止消费
   */
  async stop(): Promise<void> {
    console.log('[RedisLogConsumer] Stopping...');
    this.isRunning = false;

    // 等待一个轮询周期确保循环退出
    await this.sleep(this.pollInterval + 100);

    this.closeStreams();

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }

    console.log(
      `[RedisLogConsumer] Stopped. Total consumed: ${this.consumedCount}`,
    );
  }

  /**
   * 获取消费统计
   */
  getStats(): { consumedCount: number; isRunning: boolean } {
    return {
      consumedCount: this.consumedCount,
      isRunning: this.isRunning,
    };
  }
}
