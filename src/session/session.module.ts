import { Module, forwardRef } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { DifyModule } from '../dify/dify.module';
import { MessageModule } from '../message/message.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { TicketModule } from '../ticket/ticket.module';
import { QueueModule } from '../queue/queue.module';
import { TranslationModule } from '../shared/translation/translation.module';
import { RagModule } from '../rag/rag.module';
import { SessionRagService } from './session-rag.service';

@Module({
  imports: [
    DifyModule,
    MessageModule,
    TranslationModule,
    RagModule,
    forwardRef(() => WebsocketModule),
    forwardRef(() => TicketModule),
    QueueModule,
  ],
  controllers: [SessionController],
  providers: [
    SessionService,
    SessionRagService,
  ],
  exports: [
    SessionService,
    SessionRagService,
  ],
})
export class SessionModule {}
