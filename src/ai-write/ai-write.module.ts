import { Module } from '@nestjs/common';
import { AiWriteController } from './ai-write.controller';
import { AiWriteService } from './ai-write.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [AiWriteController],
  providers: [AiWriteService],
  exports: [AiWriteService],
})
export class AiWriteModule {}