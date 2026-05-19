import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { StigptChatController } from './stigpt-chat.controller';
import { StigptChatService } from './stigpt-chat.service';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [StigptChatController],
  providers: [StigptChatService],
  exports: [StigptChatService],
})
export class StigptChatModule {}
