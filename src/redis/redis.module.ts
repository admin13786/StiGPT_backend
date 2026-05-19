import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const logger = new Logger('RedisModule');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        // 优先使用 REDIS_URL，如果没有则使用 REDIS_HOST + REDIS_PORT
        const redisUrl = configService.get<string>('REDIS_URL');

        // 从环境变量读取配置
        const maxRetriesPerRequest = configService.get<number>(
          'REDIS_MAX_RETRIES_PER_REQUEST',
          3,
        );
        const maxReconnectAttempts = configService.get<number>(
          'REDIS_MAX_RECONNECT_ATTEMPTS',
          5,
        );
        const retryDelayBase = configService.get<number>(
          'REDIS_RETRY_DELAY_BASE',
          200,
        );
        const retryDelayMax = configService.get<number>(
          'REDIS_RETRY_DELAY_MAX',
          2000,
        );
        const connectTimeout = configService.get<number>(
          'REDIS_CONNECT_TIMEOUT',
          5000,
        );

        let redis: Redis;
        const commonOptions = {
          maxRetriesPerRequest,
          retryStrategy: (times) => {
            if (times > maxReconnectAttempts) {
              logger.error('Redis 连接失败，已达到最大重试次数');
              return null;
            }
            const delay = Math.min(times * retryDelayBase, retryDelayMax);
            logger.warn(
              `Redis 重连中... (${times}/${maxReconnectAttempts})，${delay}ms 后重试`,
            );
            return delay;
          },
          connectTimeout,
          lazyConnect: false,
          enableOfflineQueue: true,
          enableReadyCheck: true,
        };

        if (redisUrl) {
          redis = new Redis(redisUrl, commonOptions);
        } else {
          // 降级到旧的配置方式
          const host = configService.get<string>('REDIS_HOST', 'localhost');
          const port = configService.get<number>('REDIS_PORT', 6379);
          redis = new Redis({
            host,
            port,
            ...commonOptions,
          });
        }

        // 等待连接就绪
        return new Promise<Redis>((resolve, reject) => {
          const timeout = setTimeout(() => {
            logger.warn('Redis 连接超时，但继续启动应用（离线模式）');
            resolve(redis);
          }, connectTimeout);

          redis.on('ready', () => {
            clearTimeout(timeout);
            logger.log('Redis Client Connected');
            resolve(redis);
          });

          redis.on('error', (err) => {
            logger.error('Redis Client Error:', err.message);
          });

          redis.on('connect', () => {
            logger.log('Redis Client Connecting...');
          });
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
