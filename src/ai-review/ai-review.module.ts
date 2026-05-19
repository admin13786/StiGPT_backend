import { Module } from '@nestjs/common';
import { AiReviewController } from './ai-review.controller';
import { AiReviewService } from './ai-review.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [AiReviewController],
  providers: [AiReviewService],
  exports: [AiReviewService],
})
export class AiReviewModule {}