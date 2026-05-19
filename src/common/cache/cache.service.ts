import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AppLogger } from '../logger/app-logger.service';

type CacheOptions = {
  cacheNull?: boolean;
  negativeTtlSeconds?: number;
};

@Injectable()
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly enabled: boolean;
  private readonly jitterPct: number;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    const enabledValue = this.configService.get<string | boolean>(
      'CACHE_ENABLED',
    );
    this.enabled = enabledValue !== false && enabledValue !== 'false';
    const jitterPct = parseFloat(
      this.configService.get<string>('CACHE_JITTER_PCT') || '0.1',
    );
    this.jitterPct = Number.isFinite(jitterPct)
      ? Math.max(0, jitterPct)
      : 0.1;
    this.logger.setContext(CacheService.name);
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(`Cache get failed for ${key}`);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.enabled) return;
    const ttl = this.withJitterTtl(ttlSeconds);
    if (ttl <= 0) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.warn(`Cache set failed for ${key}`);
    }
  }

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<T> {
    if (!this.enabled) return loader();

    const cached = await this.getJson<T>(key);
    if (cached !== null) {
      return cached;
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      return inflight as Promise<T>;
    }

    const promise = (async () => {
      try {
        const value = await loader();
        if (value !== null && value !== undefined) {
          await this.setJson(key, value, ttlSeconds);
        } else if (options.cacheNull) {
          const negativeTtl =
            options.negativeTtlSeconds ?? Math.min(60, ttlSeconds);
          await this.setJson(key, value as T, negativeTtl);
        }
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  async del(key: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for ${key}`);
    }
  }

  async delMany(keys: string[]): Promise<void> {
    if (!this.enabled || keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(`Cache delete failed for ${keys.length} keys`);
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    if (!this.enabled) return;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          '100',
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Cache prefix delete failed for ${prefix}`);
    }
  }

  private withJitterTtl(ttlSeconds: number): number {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return 0;
    if (this.jitterPct <= 0) return Math.floor(ttlSeconds);
    const delta = Math.floor(ttlSeconds * this.jitterPct);
    const min = Math.max(1, ttlSeconds - delta);
    const max = Math.max(min, ttlSeconds + delta);
    return Math.floor(min + Math.random() * (max - min + 1));
  }
}
