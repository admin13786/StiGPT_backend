import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from './queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../common/logger/app-logger.service';

/**
 * 队列调度服务 - 定期同步队列数据
 */
@Injectable()
export class QueueSchedulerService {
  private readonly logger: AppLogger;

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(QueueSchedulerService.name);
  }

  /**
   * 每分钟同步一次队列数据到数据库
   * 确保数据库中的 queuePosition 字段与 Redis 保持一致
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'syncQueueToDatabase',
  })
  async handleSyncQueueToDatabase() {
    try {
      await this.queueService.syncQueueToDatabase();
    } catch (error) {
      this.logger.error(
        `同步队列数据到数据库失败: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * 每5分钟检查一次数据一致性
   * 修复数据库中有但Redis中没有的会话
   */
  @Cron('*/5 * * * *', {
    name: 'checkQueueConsistency',
  })
  async handleCheckConsistency() {
    try {
      this.logger.debug('开始检查队列数据一致性...');

      if (!(await this.queueService.isRedisAvailable())) {
        this.logger.debug('Redis 不可用，跳过一致性检查');
        return;
      }

      // 1. 检查数据库中的 QUEUED 会话是否都在 Redis 中
      const queuedSessions = await this.prisma.session.findMany({
        where: {
          status: 'QUEUED',
          queuedAt: { not: null }, // 确保有排队时间
        },
        select: {
          id: true,
          agentId: true,
          priorityScore: true,
          queuedAt: true,
        },
      });

      let fixedCount = 0;
      let failedCount = 0;

      for (const session of queuedSessions) {
        if (!session.queuedAt) continue;

        // 检查会话是否在 Redis 中
        const queuePosition = await this.queueService.getQueuePosition(
          session.id,
          session.agentId,
        );

        if (queuePosition === null) {
          // 数据库中有但 Redis 中没有，需要恢复
          // 使用重试版本，失败时不抛出异常
          let success = false;
          if (session.agentId) {
            success = await this.queueService.addToAgentQueueWithRetry(
              session.id,
              session.agentId,
              session.priorityScore || 0,
              session.queuedAt,
            );
          } else {
            success = await this.queueService.addToUnassignedQueueWithRetry(
              session.id,
              session.priorityScore || 0,
              session.queuedAt,
            );
          }

          if (success) {
            fixedCount++;
          } else {
            failedCount++;
            // ✅ 保留 WARN 日志（符合宪法）
            this.logger.warn(
              `恢复会话 ${session.id} 失败（Redis 可能不可用，将在下次检查时重试）`,
            );
          }
        }
      }

      // ✅ 聚合日志：循环结束后输出一次总结
      const total = fixedCount + failedCount;
      if (total > 0) {
        this.logger.log(
          `一致性检查完成：total=${total}, success=${fixedCount}, failed=${failedCount}`,
        );
      } else {
        this.logger.debug('一致性检查完成，未发现不一致');
      }
    } catch (error) {
      this.logger.error(`一致性检查失败: ${error.message}`, error.stack);
    }
  }
}
