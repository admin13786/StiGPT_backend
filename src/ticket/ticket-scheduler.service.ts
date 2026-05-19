import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketService } from './ticket.service';
import { AppLogger } from '../common/logger/app-logger.service';

@Injectable()
export class TicketSchedulerService {
  private readonly logger: AppLogger;

  constructor(
    private ticketService: TicketService,
    logger: AppLogger,
  ) {
    this.logger = logger;
    this.logger.setContext(TicketSchedulerService.name);
  }

  /**
   * 每小时执行一次定时任务
   * 检查过期工单并根据差异化策略自动关闭
   * - WAITING 状态：72 小时超时
   * - IN_PROGRESS 状态（客服已回复）：24 小时超时
   * Cron 表达式：每小时执行一次
   */
  @Cron('0 * * * *', {
    name: 'checkStaleTickets',
    timeZone: 'Asia/Shanghai',
  })
  async handleStaleTicketsCheck() {
    // 检查功能开关
    if (process.env.ENABLE_AUTO_CLOSURE !== 'true') {
      this.logger.log('自动关闭功能已禁用，跳过定时任务');
      return;
    }

    this.logger.log('开始执行定时任务：检查过期工单');
    try {
      await this.ticketService.checkStaleTickets();
      this.logger.log('定时任务执行完成：检查过期工单');
    } catch (error) {
      this.logger.error(`定时任务执行失败: ${error.message}`, error.stack);
    }
  }
}
