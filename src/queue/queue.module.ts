import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueSchedulerService } from './queue-scheduler.service';

@Module({
  providers: [QueueService, QueueSchedulerService],
  exports: [QueueService],
})
export class QueueModule {}
