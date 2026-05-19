import { Module, Global } from '@nestjs/common';
import { TraceService } from './trace.service';
import { AppLogger } from './app-logger.service';
import { LoggerService } from './logger.service';
import { RedisLogBufferService } from './redis-log-buffer.service';
import { RedisLogConsumerService } from './redis-log-consumer.service';
import { RateLimitCircuitBreakerService } from './rate-limit-circuit-breaker.service';

/**
 * 日志模块
 *
 * 使用 @Global() 装饰器，使得日志相关服务在整个应用中可用
 *
 * 服务：
 * - TraceService: 链路追踪（AsyncLocalStorage）
 * - AppLogger: 应用层日志门面
 * - LoggerService: 核心日志写入服务（含压缩归档）
 * - RedisLogBufferService: Redis 日志缓冲（生产者）
 * - RedisLogConsumerService: Redis 日志消费者（持久化）
 * - RateLimitCircuitBreakerService: 429 错误熔断器
 */
@Global()
@Module({
  providers: [
    TraceService,
    AppLogger,
    LoggerService,
    RedisLogBufferService,
    RedisLogConsumerService,
    RateLimitCircuitBreakerService,
  ],
  exports: [
    TraceService,
    AppLogger,
    LoggerService,
    RedisLogBufferService,
    RedisLogConsumerService,
    RateLimitCircuitBreakerService,
  ],
})
export class LoggerModule {}
