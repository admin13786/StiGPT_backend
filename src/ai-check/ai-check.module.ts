import { Module } from '@nestjs/common';
import { AiCheckController } from './ai-check.controller';
import { AiCheckService } from './ai-check.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [AiCheckController],
  providers: [AiCheckService],
  exports: [AiCheckService],
})
export class AiCheckModule {}