import { Module } from '@nestjs/common';
import { PaperController } from './paper.controller';
import { PaperService } from './paper.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { VectorModule } from '../vector/vector.module';
import { DocumentModule } from '../document/document.module';

@Module({
  imports: [PrismaModule, RagModule, VectorModule, DocumentModule],
  controllers: [PaperController],
  providers: [PaperService],
  exports: [PaperService],
})
export class PaperModule {}
