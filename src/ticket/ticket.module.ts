import { Module, forwardRef } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { TicketPriorityService } from './ticket-priority.service';
import { TicketSchedulerService } from './ticket-scheduler.service';
import { IssueTypeModule } from '../issue-type/issue-type.module';
import { TicketMessageModule } from '../ticket-message/ticket-message.module';
import { MessageModule } from '../message/message.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { SessionModule } from '../session/session.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    IssueTypeModule,
    TicketMessageModule,
    MessageModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => SessionModule),
    QueueModule,
  ],
  controllers: [TicketController],
  providers: [
    TicketService,
    TicketPriorityService,
    TicketSchedulerService,
  ],
  exports: [
    TicketService,
  ],
})
export class TicketModule {}
